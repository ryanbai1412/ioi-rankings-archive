/* IOI Rankings Archive
 *
 * A timeline for the scoreboard: it lets one scrub through the contest and see
 * the scoreboard as it was at any moment, or play it back.
 */

import $ from "jquery";
import DataStore, {round} from "./DataStore.js";
import Debug from "./Debug.js";
import Follow from "./Follow.js";
import HistoryStore from "./HistoryStore.js";
import Overview from "./Overview.js";
import Scoreboard from "./Scoreboard.js";
import Settings from "./Settings.js";
import {format_time} from "./TimeView.js";

// The slider works on integers, so we use a fine-grained range and normalize
const SLIDER_STEPS = 100000;

// Contest seconds per real second at 1x, so that a 5 hour day lasts a minute
const BASE_RATE = 300;

// "Real time" undoes the base compression: one contest second per real second
const REAL_TIME = 1 / BASE_RATE;

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, REAL_TIME];

// The fractional speeds show as vulgar fractions, and real time as "1:1",
// to fit the compact button
function format_speed(speed) {
    if (speed === REAL_TIME) {
        return "1:1";
    }
    if (speed === 0.25) {
        return "\u00BC\u00D7";
    }
    if (speed === 0.5) {
        return "\u00BD\u00D7";
    }
    return speed + "\u00D7";
}

// The dropdown has room for the real-time option's full name
function menu_label(speed) {
    return speed === REAL_TIME ? "Real time" : format_speed(speed);
}

// Bounds for how often the scoreboard is recomputed while playing (in ms):
// the actual pace adapts between them to what the device can render
const MIN_FRAME_INTERVAL = 60;
const MAX_FRAME_INTERVAL = 500;

// Scrubbing to within this many pixels of a tick snaps to it
const SNAP_PIXELS = 12;

// How far the arrow keys step, in contest seconds
const ARROW_STEP = 15 * 60;

// How far J and L jump, in contest seconds
const JUMP_STEP = 60 * 60;

// A scoreboard update slower than this is a slow frame, and this many
// consecutive slow frames flip the animation settings' default to off
// (unless the user explicitly turned them on)
const SLOW_FRAME_MS = 40;
const SLOW_FRAME_LIMIT = 10;

// Batching window for the passive rank-drop badges: drops are counted from
// the rank held at the start of the window, so a sustained slide folds
// into one badge rather than a stream of tiny ones. The badge's fade is
// given this same duration, so a window is exactly one badge's life: the
// badge stays up (updating in place) while the slide continues, and once
// it has faded out the next drop starts a fresh chunk.
const DROP_WINDOW_MS = 4000;

export default new function () {
    var self = this;

    // Position on the timeline, in [0, 1]: each contest gets an equal share of
    // it, so the breaks between contests are skipped
    self.position = 1;

    self.speed_idx = SPEEDS.indexOf(1);
    self.playing = false;
    // Whether a pointer is currently dragging on the track
    self.scrubbing = false;
    // Set while scrubbing mid-playback, to resume once the thumb is released
    self.resume_after_scrub = false;
    // Set when playback skipped an overview redraw, to catch up on pause
    self.overview_stale = false;

    // Adaptive throttle for the scoreboard updates (see on_frame)
    self.apply_interval = MIN_FRAME_INTERVAL;
    self.applied_last_frame = false;

    // Consecutive slow updates seen while animations were enabled
    self.slow_frames = 0;

    self.init = function () {
        self.contests = DataStore.contest_list;
        if (self.contests.length == 0) {
            return;
        }

        self.build_events();
        self.make_ticks();

        self.slider_el = $("#Timeline_slider");
        self.slider_el.attr({"min": 0, "max": SLIDER_STEPS, "value": SLIDER_STEPS});

        // update_ui runs on every animation frame during playback
        self.play_el = $("#Timeline_play");
        self.speed_el = $("#Timeline_speed");
        self.label_el = $("#Timeline_label");

        // Scrubbing is driven by pointer events on the whole track, not by
        // the (pointer-events: none) slider itself: this way the hit target
        // is the full-height timeline band, a press anywhere jumps the thumb
        // there, and dragging behaves the same on touch and mouse (native
        // range inputs on mobile only react to touches on the thumb itself)
        var track = $("#Timeline_track")[0];

        track.addEventListener("pointerdown", function (event) {
            if (!event.isPrimary) {
                return;
            }
            track.setPointerCapture(event.pointerId);

            // Hold playback while scrubbing, but remember to resume
            if (self.playing) {
                self.pause();
                self.resume_after_scrub = true;
            }

            self.scrubbing = true;
            // The drag keeps these measurements for its whole run: the
            // scoreboard geometry, and the track's own rectangle (reading
            // it on every move would force a layout after each tick's
            // DOM writes)
            Scoreboard.geometry = undefined;
            self.scrub_rect = self.slider_el[0].getBoundingClientRect();
            self.last_scrub_apply = 0;
            self.scrub_to(event.clientX, false);
        });

        track.addEventListener("pointermove", function (event) {
            if (self.scrubbing && event.isPrimary) {
                self.scrub_to(event.clientX, false);
            }
        });

        var end_scrub = function (event, cancelled) {
            if (!self.scrubbing || !event.isPrimary) {
                return;
            }
            self.scrubbing = false;

            if (cancelled) {
                // A cancelled pointer carries no useful coordinates: settle
                // where the last move left us, applying any update the
                // scrub throttling deferred
                self.set_position(self.position);
            } else {
                self.scrub_to(event.clientX, true);
            }

            if (self.resume_after_scrub) {
                self.resume_after_scrub = false;
                // Don't restart from the beginning if dragged to the very end
                if (self.position < 1) {
                    self.play();
                }
            }

            // Catch up on an overview redraw the scrub ticks deferred
            // (unless playback resumed, in which case the next pause will)
            if (!self.playing && self.overview_stale) {
                self.update_overview();
            }
        };

        track.addEventListener("pointerup", function (event) {
            end_scrub(event, false);
        });
        track.addEventListener("pointercancel", function (event) {
            end_scrub(event, true);
        });

        $("#Timeline_ticks").on("click", ".Timeline_tick", function () {
            self.set_position(parseFloat($(this).attr("data-position")));
        });

        $("#Timeline_prev").click(function () {
            self.pause();
            self.seek(-1);
        });

        $("#Timeline_next").click(function () {
            self.pause();
            self.seek(+1);
        });

        $("#Timeline_play").click(function () {
            self.toggle_play();
        });

        // The speed button opens a dropdown with one option per speed
        self.speed_box_el = $("#Timeline_speed_box");
        self.speed_menu_el = $("#Timeline_speed_menu");

        var options = "";
        for (var i = 0; i < SPEEDS.length; i += 1) {
            options += "<button type=\"button\" class=\"Timeline_speed_option\"" +
                       " data-idx=\"" + i + "\">" + menu_label(SPEEDS[i]) +
                       "</button>";
        }
        self.speed_menu_el.html(options);

        $("#Timeline_speed").click(function () {
            self.speed_box_el.toggleClass("open");
        });

        self.speed_menu_el.on("click", ".Timeline_speed_option", function () {
            self.set_speed(parseInt(this.dataset["idx"], 10));
            self.speed_box_el.removeClass("open");
        });

        $(document).on("mousedown", function (event) {
            if (self.speed_box_el.hasClass("open") &&
                !$.contains(self.speed_box_el[0], event.target)) {
                self.speed_box_el.removeClass("open");
            }
        });

        self.set_speed(self.speed_idx);

        // Until now the markup was the greyed-out pre-load skeleton
        // (identical geometry, everything disabled)
        $("#Timeline").removeClass("loading");
        $("#Timeline_controls button").prop("disabled", false);
        // The slider must not stay disabled: mobile Safari dims disabled
        // controls (fading the fill color), overriding the custom styling.
        // It remains inert to pointers (the track does the scrubbing), but
        // becomes focusable: the keydown handler below overrides its arrow
        // keys, and any key it handles natively (Home, End, Page Up/Down)
        // moves the timeline through this input listener, so the thumb can
        // never drift out of sync with the actual position.
        self.slider_el.prop("disabled", false);
        self.slider_el.on("input", function () {
            self.set_position(parseInt(this.value, 10) / SLIDER_STEPS);
        });

        $(document).on("keydown", function (event) {
            // Leave typing alone (e.g. the team search box); the slider is
            // ours though, and we override its native tiny arrow steps
            if (event.target !== self.slider_el[0] &&
                $(event.target).is("input, textarea, select, [contenteditable]")) {
                return;
            }

            // A focused button keeps its native Space/Enter activation
            // (e.g. Space on the tabbed-to follow dropdown's toggle must
            // open it, not start playback). Only keyboard focus can reach
            // here: the pointerup handler below drops the focus a mouse
            // click would otherwise leave on a button.
            if ($(event.target).is("button") &&
                (event.key === " " || event.key === "Enter")) {
                return;
            }

            if (event.ctrlKey || event.altKey || event.metaKey) {
                return;
            }

            switch (event.key) {
            case " ":
                event.preventDefault();
                self.toggle_play();
                break;
            case "ArrowLeft":
                event.preventDefault();
                self.advance(-ARROW_STEP);
                break;
            case "ArrowRight":
                event.preventDefault();
                self.advance(+ARROW_STEP);
                break;
            case "j":
            case "J":
                event.preventDefault();
                self.advance(-JUMP_STEP);
                break;
            case "l":
            case "L":
                event.preventDefault();
                self.advance(+JUMP_STEP);
                break;
            case "k":
            case "K":
                event.preventDefault();
                self.toggle_play();
                break;
            case "Escape":
                self.speed_box_el.removeClass("open");
                break;
            }
        });

        // Clicking a button leaves it focused, and the exemption above
        // would then hand Space to that button (re-triggering it) instead
        // of toggling playback. Blur it once the pointer interaction ends:
        // keyboard activation fires no pointer events, so tab focus (and
        // its Space/Enter handling) is unaffected. (:focus-visible can't
        // tell the cases apart here: pressing a key puts the mouse-focused
        // button into that state before the keydown handler runs.)
        $(document).on("pointerup pointercancel", "button", function () {
            this.blur();
        });

        self.update_ui();
    };


    ////// Score events

    /* We turn the score history into a list of events, each one holding the
       score the task had before it and the score it has after it, so that we
       can walk the timeline in both directions applying (or undoing) only the
       events we cross.
     */

    self.build_events = function () {
        self.events = new Array();

        for (const entry of HistoryStore.history_t) {
            var u_id = entry[0], t_id = entry[1], time = entry[2], score = entry[3];

            var task = DataStore.tasks[t_id];
            if (DataStore.users[u_id] === undefined || task === undefined) {
                continue;
            }

            // The user object and the property to poke are resolved once
            // here: the apply loops run over thousands of events per tick
            self.events.push({"user": u_id, "task": t_id, "time": time,
                              "user_obj": DataStore.users[u_id],
                              "t_key": "t_" + t_id, "key": u_id + "/" + t_id,
                              "score": round(score, task["score_precision"]),
                              "prev_score": 0.0});
        }

        // A stable sort, so same-time events for a key keep their order
        self.events.sort(function (a, b) {
            return a["time"] - b["time"];
        });

        // Each event's "before" score is the previous event's "after" score,
        // chained in sorted time order so that undoing events while seeking
        // backwards restores the right values (the source data happens to be
        // time-sorted already, but nothing should depend on that)
        var last_score = new Object();
        for (const event of self.events) {
            event["prev_score"] = last_score[event["key"]] || 0.0;
            last_score[event["key"]] = event["score"];
        }

        // All the events have been applied, since we start at the end
        self.applied = self.events.length;
    };

    // Walk the event pointer to the given (absolute) time, poking the
    // crossed events' scores into the user objects. Returns the affected
    // users in "dirty" (keyed by user id) and, when track_scores is set,
    // the first and last score seen per changed cell (keyed "user/task"),
    // so that a batch of crossed events nets out for the flash effects.
    self.cross_events = function (time, track_scores) {
        var dirty = new Object();
        var first_score = new Object();
        var last_score = new Object();

        while (self.applied < self.events.length &&
               self.events[self.applied]["time"] <= time) {
            var event = self.events[self.applied];
            event["user_obj"][event["t_key"]] = event["score"];
            dirty[event["user"]] = true;
            if (track_scores) {
                if (!(event["key"] in first_score)) {
                    first_score[event["key"]] = event["prev_score"];
                }
                last_score[event["key"]] = event["score"];
            }
            self.applied += 1;
        }

        while (self.applied > 0 && self.events[self.applied - 1]["time"] > time) {
            self.applied -= 1;
            var event = self.events[self.applied];
            event["user_obj"][event["t_key"]] = event["prev_score"];
            dirty[event["user"]] = true;
            if (track_scores) {
                if (!(event["key"] in first_score)) {
                    first_score[event["key"]] = event["score"];
                }
                last_score[event["key"]] = event["prev_score"];
            }
        }

        return {"dirty": dirty,
                "first_score": first_score,
                "last_score": last_score};
    };

    // Set the scoreboard to the state it had at the given (absolute) time.
    //
    // The DOM reads and writes in here are carefully ordered to avoid
    // forced reflows (see the individual comments): all the reads happen
    // against a clean layout or the cached geometry, then the writes go in.
    self.apply_time = function (time) {
        var start = performance.now();

        // The cached geometry goes stale as the page settles (rows grow when
        // fonts and images come in), so take fresh measurements on discrete
        // jumps; during continuous playback or scrubbing the measurement
        // from the start of the gesture is kept, since re-measuring on every
        // tick would force a reflow each time
        if (!self.playing && !self.scrubbing) {
            Scoreboard.geometry = undefined;
        }

        // Read the viewport now, while the layout is still clean: doing it
        // after the writes below would force a synchronous reflow
        var range = Scoreboard.visible_range();

        // Flashes, badges and slides follow the display settings, and switch
        // off at high playback speeds, where they can't be read anyway. On
        // discrete jumps and scrub ticks the rows slide FLIP-style from
        // measured positions; during playback they slide from index-derived
        // positions instead (since layout reads on every tick are too slow)
        // and only when their own nested setting asks for them.
        var readable = !self.playing || SPEEDS[self.speed_idx] <= 4;
        var flashes = readable && Settings.get("score_flashes");
        var deltas = readable && Settings.get("rank_deltas");
        var drops = readable && Settings.get("rank_drops");
        var effects = flashes || deltas || drops;
        var slide = !self.playing && Settings.get("row_slides");
        var playback_slides = self.playing && readable &&
                              Settings.get("playback_slides");

        // Ranks in the currently displayed sorting, snapshotted before the
        // events mutate any scores, so the rank-delta badges reflect the
        // active column rather than always the global standings
        var old_ranks = deltas || drops ? Scoreboard.get_local_ranks() : null;

        var crossed = self.cross_events(time, effects);
        var dirty = crossed["dirty"];

        if ($.isEmptyObject(dirty)) {
            return;
        }

        for (var u_id in dirty) {
            DataStore.recompute_scores(u_id);
        }

        DataStore.recompute_ranks();

        for (var u_id in dirty) {
            Scoreboard.refresh_user(DataStore.users[u_id]);
        }

        // During playback the pre-sort positions come from the sorted
        // indexes and the cached row height, avoiding any layout read
        var old_indices = playback_slides ?
            Scoreboard.snapshot_indices() : null;

        var old_range = range;

        // On discrete jumps and scrub ticks the reorder helper measures
        // the rows and slides them from their true positions — the same
        // path the interactive reorders (sort clicks, filter toggles) take
        Scoreboard.reorder_with_slides(function () {
            // Ranks (and thus the order) may have changed for everyone
            Scoreboard.sort();

            Follow.recenter();

            // The recenter may have scrolled the frame: refresh the
            // viewport span so the effects below judge visibility against
            // where the view ended up, or the followed row would miss its
            // own badges whenever it jumps (the geometry cache makes this
            // a plain scrollTop read)
            if (effects || playback_slides) {
                range = Scoreboard.visible_range();
            }
        }, slide);

        if (old_indices !== null) {
            // Slides run in viewport space: the recenter's instant scroll
            // jump is folded into every row's delta, so with a followed
            // row on the move the camera work reads as the others flowing
            // smoothly past a pinned row, not as everything lurching
            Scoreboard.animate_playback_sort(
                old_indices, range, range["top"] - old_range["top"]);
        }

        if (flashes) {
            self.show_flashes(crossed["first_score"], crossed["last_score"],
                              range);
        }

        if (deltas || drops) {
            var new_ranks = Scoreboard.get_local_ranks();
            if (deltas) {
                self.show_delta_badges(dirty, old_ranks, new_ranks, range);
            }
            if (drops) {
                self.show_drop_badges(dirty, old_ranks, new_ranks, range);
            }
        }

        if (Debug.enabled) {
            Debug.report_apply({
                "elapsed": performance.now() - start,
                "interval": self.apply_interval,
                "applied": self.applied,
                "total": self.events.length,
                "dirty": Object.keys(dirty).length
            });
        }

        // Slow updates while animations run on their default-on state make
        // the default flip to off; an explicit user choice is respected.
        // Only playback frames are judged: jumps and scrub ticks include
        // the FLIP row measurement (a whole-table reflow), so they are
        // slow by design and say nothing about the device.
        if ((effects || playback_slides) && self.playing) {
            var elapsed = performance.now() - start;
            self.slow_frames = elapsed > SLOW_FRAME_MS ? self.slow_frames + 1 : 0;
            if (self.slow_frames >= SLOW_FRAME_LIMIT) {
                self.slow_frames = 0;
                Settings.report_slow_effects();
            }
        }

        // Redrawing the overview chart (SVG) is too slow to do every tick,
        // so during playback and scrubbing it's deferred until the next
        // pause (or the release of the thumb)
        if (self.playing || self.scrubbing) {
            self.overview_stale = true;
        } else {
            self.update_overview();
        }
    };

    // Flash the visible cells whose score changed, green or red for the
    // batch's net direction
    self.show_flashes = function (first_score, last_score, range) {
        for (var key in last_score) {
            var sep = key.indexOf("/");
            var user = DataStore.users[key.slice(0, sep)];
            var delta = last_score[key] - first_score[key];
            if (delta != 0 && Scoreboard.is_row_visible(user, range)) {
                Scoreboard.flash_cell(user, key.slice(sep + 1), delta);
            }
        }
    };

    // Rank badges on the visible rows whose own score changes moved them
    self.show_delta_badges = function (dirty, old_ranks, new_ranks, range) {
        for (var u_id in dirty) {
            var user = DataStore.users[u_id];
            if (old_ranks[u_id] !== undefined && new_ranks[u_id] !== undefined &&
                old_ranks[u_id] != new_ranks[u_id] &&
                Scoreboard.is_row_visible(user, range)) {
                Scoreboard.show_rank_delta(user, old_ranks[u_id], new_ranks[u_id]);
            }
        }
    };

    // Badges on rows that fell only because others scored. One submission
    // elsewhere pushes many rows down by one, and a busy stretch does so
    // on every tick, so these are batched: the drop is counted from the
    // rank held at the start of a short window (reset by the user's own
    // score changes), giving one folded badge instead of a stream of tiny
    // ones.
    self.show_drop_badges = function (dirty, old_ranks, new_ranks, range) {
        var now = performance.now();

        for (var u_id in new_ranks) {
            if (dirty[u_id] !== undefined ||
                old_ranks[u_id] === undefined ||
                new_ranks[u_id] <= old_ranks[u_id]) {
                continue;
            }
            var user = DataStore.users[u_id];
            if (!Scoreboard.is_row_visible(user, range)) {
                continue;
            }
            if (user["drop_start"] === undefined ||
                now - user["drop_start"] > DROP_WINDOW_MS) {
                user["drop_start"] = now;
                user["drop_from"] = old_ranks[u_id];
                // A fresh window is a fresh chunk: a badge still fading
                // from before (the previous window's drop, or a climb)
                // must not fold this chunk into its old base
                Scoreboard.end_rank_delta(user);
            }
            if (new_ranks[u_id] > user["drop_from"]) {
                Scoreboard.show_rank_delta(user, user["drop_from"],
                                           new_ranks[u_id], DROP_WINDOW_MS);
            }
        }

        // A row's own score change ends its batching window
        for (var u_id in dirty) {
            DataStore.users[u_id]["drop_start"] = undefined;
        }
    };

    self.update_overview = function () {
        self.overview_stale = false;

        Overview.recompute();
        Overview.update_score_chart(0);
        Overview.user_list.sort(Overview.compare_users);
        Overview.update_markers(0);
    };


    ////// Timeline geometry

    /* The timeline position in [0, 1] maps onto the contests by giving each
       an equal share, so the breaks between contests are skipped. These
       helpers convert between a position and a (contest index, seconds into
       the contest) pair; all the other time math is built on them.
     */

    // How long the given contest runs, in seconds
    self.duration = function (idx) {
        return self.contests[idx]["end"] - self.contests[idx]["begin"];
    };

    // The contest the given position falls in and how far into it it is
    self.locate = function (position) {
        var n = self.contests.length;
        var idx = Math.min(Math.floor(position * n), n - 1);
        return {
            "idx": idx,
            "elapsed": (position * n - idx) * self.duration(idx)
        };
    };

    self.position_of = function (idx, elapsed) {
        return (idx + elapsed / self.duration(idx)) / self.contests.length;
    };

    // The time the given position on the timeline corresponds to. The very end
    // of the timeline is the end of the archive (which may be later than the
    // end of the last contest, if scores were changed afterwards).
    self.get_time = function (position) {
        if (position >= 1) {
            return Infinity;
        }

        var at = self.locate(position);
        return self.contests[at["idx"]]["begin"] + at["elapsed"];
    };

    // The positions one can seek to: the begin of each contest and the end
    self.get_stops = function () {
        var stops = new Array();
        for (var i = 0; i < self.contests.length; i += 1) {
            stops.push(i / self.contests.length);
        }
        stops.push(1);
        return stops;
    };

    self.make_ticks = function () {
        var stops = self.get_stops();
        var result = "";

        for (var i = 0; i < stops.length; i += 1) {
            var label = i < self.contests.length ? self.contests[i]["name"] : "End";
            result += "<div class=\"Timeline_tick\" data-position=\"" + stops[i] + "\"" +
                      " style=\"left: " + (stops[i] * 100) + "%\">" +
                      "<div class=\"Timeline_tick_mark\"></div>" +
                      "<div class=\"Timeline_tick_label\">" + label + "</div></div>";
        }

        $("#Timeline_ticks").html(result);
    };


    ////// Playback

    // Move to where the pointer is. While the drag is in progress the
    // scoreboard update is throttled like during playback, since a touch
    // drag can emit far more moves than slower devices can keep up with;
    // the final position (finish == true) is always applied.
    self.scrub_to = function (client_x, finish) {
        // Measured once when the drag started (see the pointerdown handler)
        var rect = self.scrub_rect;
        // The thumb (14px wide) travels over the track minus its own width
        var travel = rect.width - 14;
        if (travel <= 0) {
            return;
        }

        var position = self.snap((client_x - rect.left - 7) / travel, travel);

        var now = performance.now();
        var skip = !finish && now - self.last_scrub_apply < self.apply_interval;
        if (!skip) {
            self.last_scrub_apply = now;
        }

        self.set_position(position, skip);
    };

    // Pull a scrubbed position onto a stop if it lands close enough to one.
    // The travel (the track's width minus the thumb's) is passed in, since
    // the caller measured it already and a re-read would force a layout.
    self.snap = function (position, travel) {
        var threshold = SNAP_PIXELS / travel;
        var stops = self.get_stops();
        var best = position;
        var best_distance = threshold;

        for (var i = 0; i < stops.length; i += 1) {
            var distance = Math.abs(stops[i] - position);
            if (distance <= best_distance) {
                best = stops[i];
                best_distance = distance;
            }
        }

        return best;
    };

    // skip_apply postpones the (expensive) scoreboard update; used during
    // playback, where on_frame applies it at a throttled pace
    self.set_position = function (position, skip_apply) {
        self.position = Math.min(Math.max(position, 0), 1);
        if (!skip_apply) {
            self.apply_time(self.get_time(self.position));
        }
        self.update_ui();
    };

    // Move to the previous (direction < 0) or next (direction > 0) stop
    self.seek = function (direction) {
        var stops = self.get_stops();
        // Ignore stops that are (almost) where we already are
        var epsilon = 1e-9;
        var target = null;

        for (var i in stops) {
            if (direction < 0 && stops[i] < self.position - epsilon) {
                target = stops[i];
            } else if (direction > 0 && stops[i] > self.position + epsilon) {
                target = stops[i];
                break;
            }
        }

        if (target !== null) {
            self.set_position(target);
        }
    };

    self.toggle_play = function () {
        if (self.playing) {
            self.pause();
        } else {
            self.play();
        }
    };

    self.play = function () {
        if (self.playing) {
            return;
        }

        if (self.position >= 1) {
            self.set_position(0);
        }

        self.playing = true;
        // Playback keeps this measurement for its whole run, so start fresh
        Scoreboard.geometry = undefined;
        self.last_frame = null;
        self.frame_request = window.requestAnimationFrame(self.on_frame);
        self.update_ui();
    };

    self.pause = function () {
        if (!self.playing) {
            return;
        }

        self.playing = false;
        window.cancelAnimationFrame(self.frame_request);
        // Catch up on updates the playback loop may have deferred
        self.apply_time(self.get_time(self.position));
        if (self.overview_stale) {
            self.update_overview();
        }
        self.update_ui();
    };

    self.on_frame = function (timestamp) {
        if (!self.playing) {
            return;
        }

        if (self.last_frame === null) {
            self.last_frame = timestamp;
            self.last_apply = timestamp;
        }

        var delta = timestamp - self.last_frame;
        self.last_frame = timestamp;

        // How long the frame containing the last scoreboard update took
        // tells us what this device can afford, so the update pace adapts
        // to it: fast machines get MIN_FRAME_INTERVAL, slow ones update the
        // scoreboard less often but keep the thumb and label smooth
        if (self.applied_last_frame) {
            self.applied_last_frame = false;
            self.apply_interval = Math.min(
                Math.max(delta * 2, MIN_FRAME_INTERVAL), MAX_FRAME_INTERVAL);
        }

        var apply = timestamp - self.last_apply >= self.apply_interval;
        if (apply) {
            self.last_apply = timestamp;
            self.applied_last_frame = true;
        }

        self.advance(delta / 1000 * BASE_RATE * SPEEDS[self.speed_idx], !apply);

        if (self.playing) {
            self.frame_request = window.requestAnimationFrame(self.on_frame);
        }
    };

    // Move by the given amount of contest seconds (may be negative)
    self.advance = function (seconds, skip_apply) {
        var n = self.contests.length;
        var at = self.locate(self.position);
        var idx = at["idx"];
        var elapsed = at["elapsed"] + seconds;

        // Carry the overflow into the neighboring contests, skipping the
        // breaks in between
        while (idx < n - 1 && elapsed >= self.duration(idx)) {
            elapsed -= self.duration(idx);
            idx += 1;
        }
        while (idx > 0 && elapsed < 0) {
            idx -= 1;
            elapsed += self.duration(idx);
        }

        if (idx == n - 1 && elapsed >= self.duration(idx)) {
            self.set_position(1);
            self.pause();
        } else {
            self.set_position(self.position_of(idx, elapsed), skip_apply);
        }
    };


    ////// UI

    // The selected marker only moves here, not in update_ui, which runs on
    // every animation frame during playback
    self.set_speed = function (idx) {
        self.speed_idx = idx;
        self.speed_menu_el.children().each(function (i) {
            $(this).toggleClass("selected", i === idx);
        });
        self.update_ui();
    };

    self.update_ui = function () {
        self.slider_el.val(Math.round(self.position * SLIDER_STEPS));
        // The fill should end under the thumb's center, and the thumb (14px
        // wide) travels over the track minus its own width
        self.slider_el.css("--Timeline_fill",
                           "calc(7px + " + self.position + " * (100% - 14px))");

        self.play_el.toggleClass("playing", self.playing)
            .attr("title", self.playing ? "Pause (Space/K)" : "Play (Space/K)");
        self.speed_el.text(format_speed(SPEEDS[self.speed_idx]));
        self.label_el.text(self.format_position());
    };

    self.format_position = function () {
        if (self.position >= 1) {
            return "Final";
        }

        var at = self.locate(self.position);
        return self.contests[at["idx"]]["name"] + " " +
               format_time(Math.floor(at["elapsed"]));
    };
};
