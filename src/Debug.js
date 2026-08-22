/* IOI Rankings Archive
 *
 * A diagnostics line under the timeline, enabled from the display settings:
 * live frame rate, scoreboard-update latency and replay counters, to judge
 * how the replay performs on a device.
 */

import $ from "jquery";
import Scoreboard from "./Scoreboard.js";
import Settings from "./Settings.js";

// How often the text is rewritten: at full frame rate the numbers move too
// fast to read (and the writes would show up in their own measurements)
const RENDER_INTERVAL = 250;

// Sliding window for the frame-rate estimate, in ms
const FPS_WINDOW = 1000;

// How many scoreboard updates the latency stats run over
const APPLY_SAMPLES = 20;

export default new function () {
    var self = this;

    // The timeline checks this flag before gathering its per-update report,
    // so a disabled debug line costs nothing on the replay path
    self.enabled = false;

    self.init = function () {
        self.el = $("#Debug");
        // requestAnimationFrame timestamps within the last FPS_WINDOW
        self.frames = [];
        // Durations of the last few scoreboard updates
        self.applies = [];
        // The full report of the most recent one
        self.last_apply = null;
        self.last_render = 0;

        Settings.on_change(function (name) {
            if (name === "debug_info") {
                self.update_state();
            }
        });
        self.update_state();
    };

    self.update_state = function () {
        var enabled = Settings.get("debug_info");
        if (enabled && !self.enabled) {
            self.frames = [];
            window.requestAnimationFrame(self.on_frame);
        }
        self.enabled = enabled;
        self.el.toggleClass("visible", enabled);
        // The timeline band grows to fit the line and the scoreboard frame
        // slides down (see Ranking.css), so the cached geometry is stale
        $("html").toggleClass("debug_info", enabled);
        Scoreboard.geometry = undefined;
    };

    // One requestAnimationFrame per displayed frame while enabled, giving
    // the frame rate the user actually experiences
    self.on_frame = function (timestamp) {
        if (!self.enabled) {
            return;
        }

        self.frames.push(timestamp);
        while (self.frames.length > 0 &&
               self.frames[0] <= timestamp - FPS_WINDOW) {
            self.frames.shift();
        }

        if (timestamp - self.last_render >= RENDER_INTERVAL) {
            self.last_render = timestamp;
            self.render();
        }

        window.requestAnimationFrame(self.on_frame);
    };

    // Called by the timeline after every scoreboard update it applies
    self.report_apply = function (report) {
        self.last_apply = report;
        self.applies.push(report["elapsed"]);
        if (self.applies.length > APPLY_SAMPLES) {
            self.applies.shift();
        }
    };

    self.render = function () {
        var parts = [];

        var frames = self.frames;
        if (frames.length > 1) {
            var fps = (frames.length - 1) * 1000 /
                      (frames[frames.length - 1] - frames[0]);
            parts.push(fps.toFixed(0) + " fps");
        } else {
            parts.push("\u2014 fps");
        }

        if (self.applies.length > 0) {
            var sum = 0;
            var max = 0;
            for (const sample of self.applies) {
                sum += sample;
                max = Math.max(max, sample);
            }
            parts.push("update " + (sum / self.applies.length).toFixed(1) +
                       " ms avg, " + max.toFixed(1) + " ms max");
        }

        if (self.last_apply !== null) {
            parts.push("interval " +
                       self.last_apply["interval"].toFixed(0) + " ms");
            parts.push("events " + self.last_apply["applied"] +
                       " / " + self.last_apply["total"]);
            parts.push("dirty rows " + self.last_apply["dirty"]);
        }

        var badges = Scoreboard.overlay_live !== undefined ?
                     Scoreboard.overlay_live.length : 0;
        parts.push("badges " + badges);

        self.el.text(parts.join(" \u00B7 "));
    };
};
