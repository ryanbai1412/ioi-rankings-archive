/* IOI Rankings Archive
 *
 * The "follow" control on the timeline row: pick a contestant from the
 * dropdown to highlight them, and the eye keeps their row locked in the
 * center of the scoreboard while it reshuffles. Scrolling manually breaks
 * the lock; clicking the eye locks back on.
 *
 * The dropdown is a custom searchable combobox: a toggle button opens a
 * panel with a search field and the contestant list, filterable by name,
 * ID or team, navigable with the keyboard.
 */

import $ from "jquery";
import Config from "./Config.js";
import DataStore from "./DataStore.js";
import Scoreboard from "./Scoreboard.js";

var escape_map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#x27;"
};

function escape_html(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
        return escape_map[ch];
    });
}

// For this long after locking on, unexpected scrolls are corrected rather
// than breaking the lock (leftover trackpad momentum from a manual scroll
// keeps producing events well past the click that locked)
const LOCK_GRACE_MS = 500;

export default new function () {
    var self = this;

    self.user_id = null;
    // Whether the followed user was already highlighted before we followed them
    self.was_selected = false;
    self.locked = false;
    self.menu_open = false;
    // When the lock last engaged (see the scroll handler's grace period)
    self.lock_time = 0;

    // All options, sorted; each is {key, label, search, el}
    self.options = new Array();
    // The subset currently visible, i.e. matching the search query
    self.filtered = new Array();
    self.active_idx = -1;

    self.init = function () {
        var timeline = $("#Timeline");
        if (timeline.length == 0) {
            return;
        }

        // The markup lives in index.html so the pre-load skeleton keeps the
        // real layout; it just needs enabling
        $("#Follow_eye, #Follow_toggle").prop("disabled", false);

        self.follow_el = $("#Follow");
        self.eye_el = $("#Follow_eye");
        self.picker_el = $("#Follow_picker");
        self.toggle_label_el = $("#Follow_toggle_label");
        self.search_el = $("#Follow_search");
        self.list_el = $("#Follow_list");
        self.empty_el = $("#Follow_empty");
        self.frame_el = $("#InnerFrame");

        self.build_options();

        $("#Follow_toggle").on("click", function () {
            if (self.menu_open) {
                self.close_menu();
            } else {
                self.open_menu();
            }
        });

        $("#Follow_clear").on("click", function () {
            self.choose(null);
        });

        self.list_el.on("click", ".Follow_option", function () {
            self.choose($(this).attr("data-user"));
        });

        // Track the pointer for the active highlight so that mouse and
        // keyboard don't fight over it
        self.list_el.on("mousemove", ".Follow_option", function () {
            var idx = self.filtered.indexOf($(this).data("option"));
            if (idx != -1 && idx != self.active_idx) {
                self.set_active(idx, false);
            }
        });

        self.search_el.on("input", function () {
            self.filter($(this).val());
        });

        self.search_el.on("keydown", function (event) {
            switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                self.set_active(Math.min(self.active_idx + 1, self.filtered.length - 1), true);
                break;
            case "ArrowUp":
                event.preventDefault();
                self.set_active(Math.max(self.active_idx - 1, 0), true);
                break;
            case "Enter":
                event.preventDefault();
                if (self.active_idx >= 0 && self.active_idx < self.filtered.length) {
                    self.choose(self.filtered[self.active_idx]["key"]);
                }
                break;
            case "Escape":
                self.close_menu();
                $("#Follow_toggle").focus();
                break;
            }
        });

        $(document).on("mousedown", function (event) {
            if (self.menu_open && !$.contains(self.picker_el[0], event.target)) {
                self.close_menu();
            }
        });

        self.eye_el.on("click", function () {
            if (self.user_id !== null) {
                self.set_locked(!self.locked);
            }
        });

        // Any scroll that isn't one we asked for breaks the lock — except
        // right after locking on, when stray events may still be arriving
        // from before the click (trackpad momentum keeps scrolling for a
        // while); those get corrected instead of cancelling the fresh lock
        self.expected_scroll = null;
        self.frame_el.on("scroll", function () {
            if (!self.locked) {
                return;
            }
            if (self.expected_scroll !== null &&
                Math.abs(self.frame_el.scrollTop() - self.expected_scroll) <= 1) {
                return;
            }
            if (performance.now() - self.lock_time < LOCK_GRACE_MS) {
                self.recenter();
                return;
            }
            self.set_locked(false);
        });

        // Re-sorting by another column moves the followed row too
        $("#Scoreboard_head").on("click", "th.score", function () {
            self.recenter();
        });

        self.update_ui();
    };


    ////// Dropdown

    self.build_options = function () {
        var users = new Array();
        for (var u_id in DataStore.users) {
            users.push(DataStore.users[u_id]);
        }

        users.sort(function (a, b) {
            return String(a["display_key"]).localeCompare(String(b["display_key"]));
        });

        var show_flags = !(DataStore.asset_config && DataStore.asset_config["noflags"]);
        var html = "";

        for (var i = 0; i < users.length; i += 1) {
            var user = users[i];
            var name = user["f_name"] + " " + user["l_name"];
            var team = user["team"];
            var team_name = team && DataStore.teams[team] ? DataStore.teams[team]["name"] : "";

            var flag = "";
            if (team && show_flags) {
                flag = "<img class=\"Follow_option_flag\" src=\"" +
                    escape_html(Config.get_flag_url(team)) + "\" alt=\"\"/>";
            }

            html += "<div class=\"Follow_option\" data-user=\"" + escape_html(user["key"]) + "\">" +
                flag +
                "<span class=\"Follow_option_id\">" + escape_html(user["display_key"]) + "</span>" +
                "<span class=\"Follow_option_name\" title=\"" + escape_html(name) + "\">" +
                escape_html(name) + "</span>" +
                "</div>";

            self.options.push({
                "key": user["key"],
                "label": user["display_key"] + " \u2013 " + name,
                "search": (user["display_key"] + " " + name + " " + team_name).toLowerCase()
            });
        }

        self.list_el.html(html);

        self.list_el.children(".Follow_option").each(function (idx) {
            self.options[idx]["el"] = $(this);
            $(this).data("option", self.options[idx]);
        });
    };

    self.open_menu = function () {
        self.menu_open = true;
        self.picker_el.addClass("open");

        self.search_el.val("");
        self.filter("");

        for (var i = 0; i < self.options.length; i += 1) {
            var option = self.options[i];
            option["el"].toggleClass("selected", option["key"] === self.user_id);

            if (option["key"] === self.user_id) {
                self.set_active(self.filtered.indexOf(option), true);
            }
        }

        self.search_el.focus();
    };

    self.close_menu = function () {
        self.menu_open = false;
        self.picker_el.removeClass("open");
    };

    self.filter = function (query) {
        query = String(query).toLowerCase().trim();

        self.filtered = new Array();

        for (var i = 0; i < self.options.length; i += 1) {
            var option = self.options[i];
            var visible = query == "" || option["search"].indexOf(query) != -1;
            option["el"].toggleClass("hidden", !visible);
            if (visible) {
                self.filtered.push(option);
            }
        }

        self.empty_el.toggle(self.filtered.length == 0);
        self.set_active(self.filtered.length > 0 ? 0 : -1, true);
    };

    // The active element is remembered directly: the index alone would go
    // stale when the filtered list is rebuilt under it, leaving the class
    // on the previous list's element
    self.set_active = function (idx, scroll) {
        if (self.active_el !== undefined) {
            self.active_el.removeClass("active");
            self.active_el = undefined;
        }

        self.active_idx = idx;

        if (idx >= 0 && idx < self.filtered.length) {
            var el = self.filtered[idx]["el"];
            self.active_el = el;
            el.addClass("active");
            if (scroll) {
                el[0].scrollIntoView({"block": "nearest"});
            }
        }
    };

    self.choose = function (u_id) {
        self.set_user(u_id);
        self.close_menu();
        $("#Follow_toggle").focus();
    };


    ////// Following

    self.set_user = function (u_id) {
        // Move the highlight from the old followed user to the new one, but
        // don't clear a highlight the user had set themselves before following
        if (self.user_id !== null && DataStore.users[self.user_id] &&
            !self.was_selected) {
            DataStore.set_selected(self.user_id, false);
        }

        self.user_id = u_id;

        if (u_id !== null) {
            self.was_selected = DataStore.get_selected(u_id) != 0;
            DataStore.set_selected(u_id, true);
            self.locked = true;
            self.lock_time = performance.now();
            self.recenter();
        } else {
            self.locked = false;
        }

        self.update_ui();
    };

    self.set_locked = function (flag) {
        self.locked = flag && self.user_id !== null;
        if (self.locked) {
            self.lock_time = performance.now();
            self.recenter();
        }
        self.update_ui();
    };

    // Scroll the scoreboard to keep the followed row vertically centered
    self.recenter = function () {
        if (!self.locked) {
            return;
        }

        var user = DataStore.users[self.user_id];
        if (user === undefined || user["row"] === undefined) {
            return;
        }

        // Computed from Scoreboard's cached geometry, not by reading the
        // row's layout: recenter runs on every replay tick, right after the
        // scoreboard was reordered, so a layout read here would force a
        // full reflow of the table
        var geometry = Scoreboard.geometry;
        if (geometry === undefined) {
            Scoreboard.measure_geometry();
            geometry = Scoreboard.geometry;
        }

        var target = Math.round(
            geometry["table_top"] + Scoreboard.row_top(user) +
            (geometry["row_height"] - geometry["frame_height"]) / 2);

        // Compare against where the frame actually is, not against the last
        // position we asked for: after a manual scroll broke the lock, the
        // remembered position may still equal the target, and relying on it
        // would turn re-locking into a no-op
        var frame = self.frame_el[0];
        if (frame.scrollTop !== target) {
            frame.scrollTop = target;
        }
        // The browser clamps the value, so read back what actually holds,
        // letting the scroll handler tell our scrolls from the user's
        self.expected_scroll = frame.scrollTop;
    };

    self.update_ui = function () {
        var title;
        if (self.user_id === null) {
            title = "Pick a contestant to follow";
        } else if (self.locked) {
            title = "Following " + DataStore.users[self.user_id]["display_key"] +
                " \u2014 click to unlock";
        } else {
            title = "Lock onto " + DataStore.users[self.user_id]["display_key"];
        }

        self.eye_el
            .toggleClass("locked", self.locked)
            .toggleClass("disabled", self.user_id === null)
            .attr("title", title);

        var label = "Follow a contestant\u2026";
        for (var i = 0; i < self.options.length; i += 1) {
            if (self.options[i]["key"] === self.user_id) {
                label = self.options[i]["label"];
            }
        }

        self.toggle_label_el.text(label);

        self.follow_el.toggleClass("following", self.user_id !== null);
    };
};
