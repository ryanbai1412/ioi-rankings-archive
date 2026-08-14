/* IOI Rankings Archive
 *
 * A timeline for the scoreboard: it lets one scrub through the contest and see
 * the scoreboard as it was at any moment, or play it back.
 */

import $ from "jquery";
import DataStore from "./DataStore.js";
import HistoryStore from "./HistoryStore.js";
import Overview from "./Overview.js";
import Scoreboard from "./Scoreboard.js";
import {format_time} from "./TimeView.js";

// The slider works on integers, so we use a fine-grained range and normalize
const SLIDER_STEPS = 100000;

const SPEEDS = [1, 2, 4, 8, 16];

// Contest seconds per real second at 1x, so that a 5 hour day lasts a minute
const BASE_RATE = 300;

// Don't recompute the scoreboard more often than this while playing (in ms)
const MIN_FRAME_INTERVAL = 60;

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

    self.init = function () {
        self.contests = DataStore.contest_list;
        if (self.contests.length == 0) {
            return;
        }

        self.build_events();
        self.make_ticks();

        self.slider_el = $("#Timeline_slider");
        self.slider_el.attr({"min": 0, "max": SLIDER_STEPS, "value": SLIDER_STEPS});

        self.slider_el.on("input", function () {
            self.pause();
            self.set_position(parseInt($(this).val(), 10) / SLIDER_STEPS);
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

            self.events.push({"user": u_id, "task": t_id, "time": time,
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
        var dirty = new Object();

        while (self.applied < self.events.length &&
               self.events[self.applied]["time"] <= time) {
            var event = self.events[self.applied];
            DataStore.users[event["user"]]["t_" + event["task"]] = event["score"];
            dirty[event["user"]] = true;
            self.applied += 1;
        }

        while (self.applied > 0 && self.events[self.applied - 1]["time"] > time) {
            self.applied -= 1;
            var event = self.events[self.applied];
            DataStore.users[event["user"]]["t_" + event["task"]] = event["prev_score"];
            dirty[event["user"]] = true;
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

        // Ranks (and thus the order) may have changed for everyone
        Scoreboard.sort();

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
            result += "<div class=\"Timeline_tick\" style=\"left: " + (stops[i] * 100) + "%\">" +
                      "<div class=\"Timeline_tick_mark\"></div>" +
                      "<div class=\"Timeline_tick_label\">" + label + "</div></div>";
        }

        $("#Timeline_ticks").html(result);
    };


    ////// Playback

    self.set_position = function (position) {
        self.position = Math.min(Math.max(position, 0), 1);
        self.apply_time(self.get_time(self.position));
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
        self.update_ui();
    };

    self.on_frame = function (timestamp) {
        if (!self.playing) {
            return;
        }

        if (self.last_frame === null) {
            self.last_frame = timestamp;
        }

        var delta = timestamp - self.last_frame;
        if (delta >= MIN_FRAME_INTERVAL) {
            self.last_frame = timestamp;
            self.advance(delta / 1000 * BASE_RATE * SPEEDS[self.speed_idx]);
        }

        if (self.playing) {
            self.frame_request = window.requestAnimationFrame(self.on_frame);
        }
    };

    // Move forward by the given amount of contest seconds
    self.advance = function (seconds) {
        var n = self.contests.length;
        var idx = Math.min(Math.floor(self.position * n), n - 1);
        var elapsed = (self.position * n - idx) *
            (self.contests[idx]["end"] - self.contests[idx]["begin"]) + seconds;

        while (idx < n - 1 && elapsed >= self.contests[idx]["end"] - self.contests[idx]["begin"]) {
            elapsed -= self.contests[idx]["end"] - self.contests[idx]["begin"];
            idx += 1;
        }

        var duration = self.contests[idx]["end"] - self.contests[idx]["begin"];

        if (idx == n - 1 && elapsed >= duration) {
            self.set_position(1);
            self.pause();
        } else {
            self.set_position((idx + elapsed / duration) / n);
        }
    };


    ////// UI

    self.update_ui = function () {
        self.slider_el.val(Math.round(self.position * SLIDER_STEPS));

        $("#Timeline").toggleClass("live", self.position < 1);
        $("#Timeline_play").text(self.playing ? "❚❚" : "▶")
            .attr("title", self.playing ? "Pause" : "Play");
        $("#Timeline_speed").text(SPEEDS[self.speed_idx] + "\u00D7");
        $("#Timeline_label").text(self.format_position());
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
