/* IOI Rankings Archive
 *
 * A timeline for the scoreboard: it lets one scrub through the contest and see
 * the scoreboard as it was at any moment, or play it back.
 */

import $ from "jquery";
import DataStore from "./DataStore.js";
import Follow from "./Follow.js";
import HistoryStore from "./HistoryStore.js";
import Overview from "./Overview.js";
import Scoreboard from "./Scoreboard.js";
import Settings from "./Settings.js";
import {format_time} from "./TimeView.js";

// The slider works on integers, so we use a fine-grained range and normalize
const SLIDER_STEPS = 100000;

const SPEEDS = [1, 2, 4, 8, 16];

// Contest seconds per real second at 1x, so that a 5 hour day lasts a minute
const BASE_RATE = 300;

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

function round(value, ndigits) {
    var factor = Math.pow(10, ndigits);
    return Math.round(value * factor) / factor;
}

export default new function () {
    var self = this;

    // Position on the timeline, in [0, 1]: each contest gets an equal share of
    // it, so the breaks between contests are skipped
    self.position = 1;

    self.speed_idx = 0;
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
            // The drag keeps this measurement for its whole run
            Scoreboard.geometry = undefined;
            self.last_scrub_apply = 0;
            self.scrub_to(event.clientX, false);
        });

        track.addEventListener("pointermove", function (event) {
            if (self.scrubbing && event.isPrimary) {
                self.scrub_to(event.clientX, false);
            }
        });

        var end_scrub = function (event) {
            if (!self.scrubbing || !event.isPrimary) {
                return;
            }
            self.scrubbing = false;
            self.scrub_to(event.clientX, true);

            if (self.resume_after_scrub) {
                self.resume_after_scrub = false;
                // Don't restart from the beginning if dragged to the very end
                if (self.position < 1) {
                    self.play();
                }
            }
        };

        track.addEventListener("pointerup", end_scrub);
        track.addEventListener("pointercancel", end_scrub);

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

        $("#Timeline_speed").click(function () {
            self.speed_idx = (self.speed_idx + 1) % SPEEDS.length;
            self.update_ui();
        });

        // Until now the markup was the greyed-out pre-load skeleton
        // (identical geometry, everything disabled)
        $("#Timeline").removeClass("loading");
        $("#Timeline_controls button").prop("disabled", false);

        $(document).on("keydown", function (event) {
            // Leave typing alone (e.g. the team search box); the slider is
            // ours though, and we override its native tiny arrow steps
            if (event.target !== self.slider_el[0] &&
                $(event.target).is("input, textarea, select, [contenteditable]")) {
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
            }
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
        var last_score = new Object();

        self.events = new Array();

        for (var i in HistoryStore.history_t) {
            var entry = HistoryStore.history_t[i];
            var u_id = entry[0], t_id = entry[1], time = entry[2], score = entry[3];

            var task = DataStore.tasks[t_id];
            if (DataStore.users[u_id] === undefined || task === undefined) {
                continue;
            }

            var key = u_id + "/" + t_id;
            var prev = last_score[key] || 0.0;
            var next = round(score, task["score_precision"]);
            last_score[key] = next;

            // The user object and the property to poke are resolved once
            // here: the apply loops run over thousands of events per tick
            self.events.push({"user": u_id, "task": t_id, "time": time,
                              "user_obj": DataStore.users[u_id],
                              "t_key": "t_" + t_id, "key": key,
                              "score": next, "prev_score": prev});
        }

        self.events.sort(function (a, b) {
            return a["time"] - b["time"];
        });

        // All the events have been applied, since we start at the end
        self.applied = self.events.length;
    };

    // Set the scoreboard to the state it had at the given (absolute) time
    self.apply_time = function (time) {
        var start = performance.now();
        var dirty = new Object();
        // First and last score seen per changed cell (keyed "user/task"),
        // so a batch of crossed events nets out for the flash effects
        var first_score = new Object();
        var last_score = new Object();

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

        // Flashes and badges follow the display settings, and switch off at
        // high playback speeds, where they can't be read anyway. Rows slide
        // on discrete jumps and while scrubbing, but not during playback,
        // where the constant reordering can't be followed.
        var readable = !self.playing || SPEEDS[self.speed_idx] <= 4;
        var flashes = readable && Settings.get("score_flashes");
        var deltas = readable && Settings.get("rank_deltas");
        var drops = readable && Settings.get("rank_drops");
        var effects = flashes || deltas || drops;
        var slide = !self.playing;

        // Ranks in the currently displayed sorting, snapshotted before the
        // events mutate any scores, so the rank-delta badges reflect the
        // active column rather than always the global standings
        var old_ranks = deltas || drops ? Scoreboard.get_local_ranks() : null;

        while (self.applied < self.events.length &&
               self.events[self.applied]["time"] <= time) {
            var event = self.events[self.applied];
            event["user_obj"][event["t_key"]] = event["score"];
            dirty[event["user"]] = true;
            if (effects) {
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
            if (effects) {
                if (!(event["key"] in first_score)) {
                    first_score[event["key"]] = event["score"];
                }
                last_score[event["key"]] = event["prev_score"];
            }
        }

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

        var measured = slide ? Scoreboard.measure_rows() : null;

        // Ranks (and thus the order) may have changed for everyone
        Scoreboard.sort();

        Follow.recenter();

        // The recenter may have scrolled the frame: refresh the viewport
        // span so the effects below judge visibility against where the view
        // ended up, or the followed row would miss its own badges whenever
        // it jumps (the geometry cache makes this a plain scrollTop read)
        if (effects) {
            range = Scoreboard.visible_range();
        }

        if (measured !== null) {
            Scoreboard.animate_sort(measured);
        }

        if (flashes) {
            for (var key in last_score) {
                var sep = key.indexOf("/");
                var user = DataStore.users[key.slice(0, sep)];
                var delta = last_score[key] - first_score[key];
                if (delta != 0 && Scoreboard.is_row_visible(user, range)) {
                    Scoreboard.flash_cell(user, key.slice(sep + 1), delta);
                }
            }
        }

        if (deltas || drops) {
            var new_ranks = Scoreboard.get_local_ranks();

            if (deltas) {
                for (var u_id in dirty) {
                    var user = DataStore.users[u_id];
                    if (old_ranks[u_id] !== undefined && new_ranks[u_id] !== undefined &&
                        old_ranks[u_id] != new_ranks[u_id] &&
                        Scoreboard.is_row_visible(user, range)) {
                        Scoreboard.show_rank_delta(user, old_ranks[u_id], new_ranks[u_id]);
                    }
                }
            }

            // Rows that fell only because others scored. One submission
            // elsewhere pushes many rows down by one, and a busy stretch
            // does so on every tick, so these are batched: the drop is
            // counted from the rank held at the start of a short window
            // (reset by the user's own score changes), giving one folded
            // badge instead of a stream of tiny ones.
            if (drops) {
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
                        // A fresh window is a fresh chunk: a badge still
                        // fading from before (the previous window's drop,
                        // or a climb) must not fold this chunk into its
                        // old base
                        Scoreboard.end_rank_delta(user);
                    }
                    if (new_ranks[u_id] > user["drop_from"]) {
                        Scoreboard.show_rank_delta(user, user["drop_from"],
                                                   new_ranks[u_id],
                                                   DROP_WINDOW_MS);
                    }
                }
                // A row's own score change ends its batching window
                for (var u_id in dirty) {
                    DataStore.users[u_id]["drop_start"] = undefined;
                }
            }
        }

        // Slow updates while animations run on their default-on state make
        // the default flip to off; an explicit user choice is respected
        if (effects) {
            var elapsed = performance.now() - start;
            self.slow_frames = elapsed > SLOW_FRAME_MS ? self.slow_frames + 1 : 0;
            if (self.slow_frames >= SLOW_FRAME_LIMIT) {
                self.slow_frames = 0;
                Settings.report_slow_effects();
            }
        }

        // Redrawing the overview chart (SVG) is too slow to do every tick,
        // so during playback it's deferred until the next pause
        if (self.playing) {
            self.overview_stale = true;
        } else {
            self.update_overview();
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

    // The time the given position on the timeline corresponds to. The very end
    // of the timeline is the end of the archive (which may be later than the
    // end of the last contest, if scores were changed afterwards).
    self.get_time = function (position) {
        if (position >= 1) {
            return Infinity;
        }

        var n = self.contests.length;
        var idx = Math.min(Math.floor(position * n), n - 1);
        var contest = self.contests[idx];

        return contest["begin"] + (position * n - idx) * (contest["end"] - contest["begin"]);
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
        var rect = self.slider_el[0].getBoundingClientRect();
        // The thumb (14px wide) travels over the track minus its own width
        var travel = rect.width - 14;
        if (travel <= 0) {
            return;
        }

        var position = self.snap((client_x - rect.left - 7) / travel);

        var now = performance.now();
        var skip = !finish && now - self.last_scrub_apply < self.apply_interval;
        if (!skip) {
            self.last_scrub_apply = now;
        }

        self.set_position(position, skip);
    };

    // Pull a scrubbed position onto a stop if it lands close enough to one
    self.snap = function (position) {
        // The thumb (14px wide) travels over the track minus its own width
        var travel = self.slider_el.width() - 14;
        if (travel <= 0) {
            return position;
        }

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
        var idx = Math.min(Math.floor(self.position * n), n - 1);
        var elapsed = (self.position * n - idx) *
            (self.contests[idx]["end"] - self.contests[idx]["begin"]) + seconds;

        while (idx < n - 1 && elapsed >= self.contests[idx]["end"] - self.contests[idx]["begin"]) {
            elapsed -= self.contests[idx]["end"] - self.contests[idx]["begin"];
            idx += 1;
        }

        while (idx > 0 && elapsed < 0) {
            idx -= 1;
            elapsed += self.contests[idx]["end"] - self.contests[idx]["begin"];
        }

        var duration = self.contests[idx]["end"] - self.contests[idx]["begin"];

        if (idx == n - 1 && elapsed >= duration) {
            self.set_position(1);
            self.pause();
        } else {
            self.set_position((idx + elapsed / duration) / n, skip_apply);
        }
    };


    ////// UI

    self.update_ui = function () {
        self.slider_el.val(Math.round(self.position * SLIDER_STEPS));
        // The fill should end under the thumb's center, and the thumb (14px
        // wide) travels over the track minus its own width
        self.slider_el.css("--Timeline_fill",
                           "calc(7px + " + self.position + " * (100% - 14px))");

        self.play_el.toggleClass("playing", self.playing)
            .attr("title", self.playing ? "Pause (Space/K)" : "Play (Space/K)");
        self.speed_el.text(SPEEDS[self.speed_idx] + "\u00D7");
        self.label_el.text(self.format_position());
    };

    self.format_position = function () {
        if (self.position >= 1) {
            return "Final";
        }

        var n = self.contests.length;
        var idx = Math.min(Math.floor(self.position * n), n - 1);
        var contest = self.contests[idx];
        var elapsed = (self.position * n - idx) * (contest["end"] - contest["begin"]);

        return contest["name"] + " " + format_time(Math.floor(elapsed));
    };
};
