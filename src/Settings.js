/* Programming contest management system
 * Copyright © 2026 the IOI rankings archive contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import $ from "jquery";

// User-facing display settings, behind the gear button in the top-right.
//
// Each setting is tri-state: "on" / "off" when the user explicitly toggled
// it (sticky, stored in localStorage) or unset, in which case a per-device
// default applies. The replay animations default to off unless the device
// looks fast (fine pointer, not mobile), and if replay frames turn out slow
// while the user never touched the toggles, the default flips itself to off
// (also remembered), so the explicit choice always wins over the heuristics.
export default new function () {
    var self = this;

    const STORAGE_KEY = "ranking_settings";
    // The remembered verdict of the runtime performance check
    const VERDICT_KEY = "ranking_effects_verdict";

    const ANIMATION_SETTINGS = ["rank_deltas", "score_flashes"];

    // Inline SVG gear: Unicode gear glyphs render differently per font, and
    // mobile platforms show them as color emoji
    const GEAR_ICON =
        "<svg viewBox='0 0 24 24' width='16' height='16' fill='currentColor'>" +
        "<path d='M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0" +
        " .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0" +
        "-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l" +
        "-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L" +
        "2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l" +
        "-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.61.22l2.39" +
        "-.96c.5.38 1.04.7 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0" +
        " 0 0 .5-.42l.36-2.54a7.03 7.03 0 0 0 1.63-.94l2.39.96c.21.1.48" +
        ".01.61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5" +
        " 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z'/></svg>";

    self.init = function () {
        self.stored = self.load(STORAGE_KEY) || {};
        self.change_callbacks = [];

        self.box_el = $("#Settings_box");
        self.panel_el = $("#Settings_panel");

        $("#Settings_button").html(GEAR_ICON).on("click", function (event) {
            event.stopPropagation();
            self.box_el.toggleClass("open");
        });
        self.panel_el.on("click", function (event) {
            event.stopPropagation();
        });
        $(document).on("click", function () {
            self.box_el.removeClass("open");
        });

        self.panel_el.find("input[data-setting]").each(function () {
            this.checked = self.get(this.dataset["setting"]);
        }).on("change", function () {
            self.set(this.dataset["setting"], this.checked);
        });

        self.update_warning();
    };

    // Detected by capability, not by parsing the user-agent string: mobile
    // browsers lie in their UA for compatibility, while a touch-only input
    // setup identifies phones and tablets reliably
    self.is_mobile = function () {
        if (navigator.userAgentData !== undefined) {
            return navigator.userAgentData.mobile;
        }
        return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
    };

    self.default_value = function (name) {
        if (ANIMATION_SETTINGS.indexOf(name) !== -1) {
            // Off unless the device gives a signal it can afford them: not
            // mobile, and no record of slow replay frames on this device
            return !self.is_mobile() &&
                   self.load(VERDICT_KEY) !== "slow";
        }
        // global_ranks
        return true;
    };

    // The effective value: the user's explicit choice, or the default
    self.get = function (name) {
        var stored = self.stored[name];
        if (stored === "on") {
            return true;
        }
        if (stored === "off") {
            return false;
        }
        return self.default_value(name);
    };

    self.is_explicit = function (name) {
        return self.stored[name] === "on" || self.stored[name] === "off";
    };

    self.set = function (name, value) {
        self.stored[name] = value ? "on" : "off";
        self.save(STORAGE_KEY, self.stored);
        self.update_warning();
        self.notify(name);
    };

    // Called by the timeline when replay frames run slow while animations
    // are enabled: remember the verdict and, for any animation setting the
    // user never explicitly toggled, let the now-off default kick in
    self.report_slow_effects = function () {
        if (self.load(VERDICT_KEY) === "slow") {
            return;
        }
        self.save(VERDICT_KEY, "slow");

        for (const name of ANIMATION_SETTINGS) {
            if (!self.is_explicit(name)) {
                self.panel_el.find("input[data-setting=" + name + "]")
                    .prop("checked", self.get(name));
                self.notify(name);
            }
        }
    };

    self.on_change = function (callback) {
        self.change_callbacks.push(callback);
    };

    self.notify = function (name) {
        for (const callback of self.change_callbacks) {
            callback(name, self.get(name));
        }
    };

    // The performance warning under the animation toggles, shown when one
    // of them is enabled on a mobile device
    self.update_warning = function () {
        var show = self.is_mobile() &&
                   (self.get("rank_deltas") || self.get("score_flashes"));
        $("#Settings_warning").toggleClass("visible", show);
    };

    self.load = function (key) {
        try {
            var raw = window.localStorage.getItem(key);
            return raw === null ? null : JSON.parse(raw);
        } catch (error) {
            return null;
        }
    };

    self.save = function (key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            // Storage may be unavailable (private mode); settings then
            // simply don't persist
        }
    };
};
