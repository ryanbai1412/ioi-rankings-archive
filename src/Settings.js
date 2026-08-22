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
    // Whether the one-time auto-disable notice has already been shown
    const NOTICE_KEY = "ranking_effects_notice";

    const ANIMATION_SETTINGS = ["rank_deltas", "rank_drops", "score_flashes"];

    self.init = function () {
        self.stored = self.load(STORAGE_KEY) || {};
        self.change_callbacks = [];

        // Console access for trying out flows by hand, e.g.
        //   Settings.set_force_mobile(true)   mobile-only UI on a desktop
        //   Settings.reset_effects_verdict(); Settings.report_slow_effects()
        window.Settings = self;

        self.box_el = $("#Settings_box");
        self.panel_el = $("#Settings_panel");

        $("#Settings_button").on("click", function (event) {
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
            // The checkboxes show each setting's own state; a nested one
            // that is gated off by its parent shows it greyed out instead
            this.checked = self.own_value(this.dataset["setting"]);
        }).on("change", function () {
            self.set(this.dataset["setting"], this.checked);
        });

        self.update_nesting();

        // The info buttons show their explanation in a floating tooltip
        // bubble: next to the pointer on hover where the device supports
        // it, and anchored to the tapped button on touch screens, where
        // there is no hover.
        var tooltip_el = $("#Settings_tooltip");
        var info_els = self.panel_el.find(".Settings_info").text("i");

        // The bubble grows to the left: the panel sits at the right edge
        // of the screen, so there is no room on the right
        var place_tooltip = function (x, y) {
            tooltip_el.css({
                "right": (window.innerWidth - x + 8) + "px",
                "top": (y + 12) + "px"
            });
        };

        var show_info = function (button) {
            info_els.removeClass("active");
            tooltip_el.toggleClass("visible", button !== undefined);
            if (button !== undefined) {
                button.addClass("active");
                tooltip_el.text(button[0].dataset["info"]);
            }
        };

        if (window.matchMedia("(hover: hover)").matches) {
            info_els.on("mouseenter", function (event) {
                show_info($(this));
                place_tooltip(event.clientX, event.clientY);
            }).on("mousemove", function (event) {
                place_tooltip(event.clientX, event.clientY);
            }).on("mouseleave", function () {
                show_info(undefined);
            });
        } else {
            info_els.on("click", function () {
                var active = $(this).hasClass("active");
                show_info(active ? undefined : $(this));
                if (!active) {
                    var rect = this.getBoundingClientRect();
                    place_tooltip(rect.right, rect.bottom);
                }
            });
        }

        self.update_warning();
    };

    // Detected by capability, not by parsing the user-agent string: mobile
    // browsers lie in their UA for compatibility, while a touch-only input
    // setup identifies phones and tablets reliably
    self.is_mobile = function () {
        if (self.force_mobile) {
            return true;
        }
        if (navigator.userAgentData !== undefined) {
            return navigator.userAgentData.mobile;
        }
        return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
    };

    // Pretend to be a mobile device, to preview the mobile-only behavior
    // (animation defaults off, the smoothness warning) from the console
    self.set_force_mobile = function (flag) {
        self.force_mobile = flag;
        // Un-toggled settings follow the device default, which just moved
        self.panel_el.find("input[data-setting]").each(function () {
            this.checked = self.own_value(this.dataset["setting"]);
        });
        self.update_warning();
        self.update_nesting();
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

    // The setting's own value: the user's explicit choice, or the default
    // (without the parent gate that get applies)
    self.own_value = function (name) {
        var stored = self.stored[name];
        if (stored === "on") {
            return true;
        }
        if (stored === "off") {
            return false;
        }
        return self.default_value(name);
    };

    // The effective value. The passive drops are a refinement of the rank
    // badges: with the badges off they are off too, whatever their own
    // toggle says (it keeps its state for when the badges come back).
    self.get = function (name) {
        if (name === "rank_drops" && !self.get("rank_deltas")) {
            return false;
        }
        return self.own_value(name);
    };

    self.is_explicit = function (name) {
        return self.stored[name] === "on" || self.stored[name] === "off";
    };

    self.set = function (name, value) {
        self.stored[name] = value ? "on" : "off";
        self.save(STORAGE_KEY, self.stored);
        self.update_warning();
        self.update_nesting();
        self.notify(name);
    };

    // Grey out the nested passive-drops toggle while its parent is off
    self.update_nesting = function () {
        self.panel_el.find("input[data-setting=rank_drops]")
            .prop("disabled", !self.get("rank_deltas"));
    };

    // Forget the remembered slow verdict and the shown-notice flag, so the
    // auto-disable flow can run (and be tried out) again on this device
    self.reset_effects_verdict = function () {
        try {
            window.localStorage.removeItem(VERDICT_KEY);
            window.localStorage.removeItem(NOTICE_KEY);
        } catch (error) {
            // Storage may be unavailable (private mode)
        }
    };

    // Called by the timeline when replay frames run slow while animations
    // are enabled: remember the verdict and, for any animation setting the
    // user never explicitly toggled, let the now-off default kick in
    self.report_slow_effects = function () {
        if (self.load(VERDICT_KEY) === "slow") {
            return;
        }
        self.save(VERDICT_KEY, "slow");

        var changed = false;
        for (const name of ANIMATION_SETTINGS) {
            if (!self.is_explicit(name)) {
                self.panel_el.find("input[data-setting=" + name + "]")
                    .prop("checked", self.own_value(name));
                self.notify(name);
                changed = true;
            }
        }
        self.update_nesting();

        if (changed && self.load(NOTICE_KEY) === null) {
            self.save(NOTICE_KEY, true);
            self.show_notice();
        }
    };

    // A one-time notice anchored to the gear button, telling the user the
    // animations were switched off because replay was running slow
    self.show_notice = function () {
        var notice = $("#Settings_notice");
        notice.addClass("visible");
        var dismiss = function () {
            notice.removeClass("visible");
        };
        // Clicking the notice opens the settings panel it talks about; the
        // stopPropagation keeps the document-level close-on-click handler
        // from immediately closing it again
        notice.off("click").on("click", function (event) {
            event.stopPropagation();
            dismiss();
            self.box_el.addClass("open");
        });
        window.setTimeout(dismiss, 8000);
    };

    self.on_change = function (callback) {
        self.change_callbacks.push(callback);
    };

    self.notify = function (name) {
        for (const callback of self.change_callbacks) {
            callback(name, self.get(name));
        }
    };

    // The performance warning under the animation toggles, shown when any
    // of them is enabled on a mobile device
    self.update_warning = function () {
        var enabled = ANIMATION_SETTINGS.some(function (name) {
            return self.get(name);
        });
        $("#Settings_warning").toggleClass("visible", self.is_mobile() && enabled);
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
