/* Programming contest management system
 * Copyright © 2012 Luca Wehrstedt <luca.wehrstedt@gmail.com>
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
import Config from "./Config.js";
import DataStore, {round_to_str} from "./DataStore.js";
import Settings from "./Settings.js";
import UserDetail from "./UserDetail.js";

var escapeMap = {
    '&' : '&amp;',
    '<' : '&lt;',
    '>' : '&gt;',
    '"' : '&quot;',
    "'" : '&#x27;',
    '/' : '&#x2F;',
    '`' : '&#x60;'
};

export function escapeHTML(str) {
    return String(str).replace(/[&<>"'\/`]/g, function(ch) {
        return escapeMap[ch];
    });
}

export default new function () {
    var self = this;

    self.init = function () {
        self.tcols_el = $('#Scoreboard_cols');
        self.thead_el = $('#Scoreboard_head');
        self.tbody_el = $('#Scoreboard_body');

        self.generate();

        DataStore.user_create.add(self.create_user);
        DataStore.user_update.add(self.update_user);
        DataStore.user_delete.add(self.delete_user);

        DataStore.select_events.add(self.select_handler);

        // The cached table geometry is only valid for the current layout
        $(window).on("resize", function () {
            self.geometry = undefined;
            self.reposition_overlay_badges();
        });

        // The rank column is only wide enough for the "(global rank)"
        // suffix while the setting is on, and the medal backgrounds on the
        // rank cells only paint while theirs is (see Ranking.css)
        $("html").toggleClass("global_ranks", Settings.get("global_ranks"));
        $("html").toggleClass("medal_colors", Settings.get("medal_colors"));

        Settings.on_change(function (name) {
            if (name === "global_ranks") {
                $("html").toggleClass("global_ranks", Settings.get("global_ranks"));
                // The column width changed, so the cached geometry is stale
                self.geometry = undefined;
                self.reposition_overlay_badges();
                self.update_ranks();
            } else if (name === "medal_colors") {
                $("html").toggleClass("medal_colors", Settings.get("medal_colors"));
            }
        });
    };


    self.generate = function () {
        self.tcols_el.html(self.make_cols());
        self.thead_el.html(self.make_head());

        // Create callbacks for sorting
        self.thead_el.on("click", "th.score", function () {
            $("col[data-sort_key=" + self.sort_key + "]", self.tcols_el).removeClass("sort_key");
            $("tr td[data-sort_key=" + self.sort_key + "]", self.thead_el).removeClass("sort_key");
            $("tr td[data-sort_key=" + self.sort_key + "]", self.tbody_el).removeClass("sort_key");

            var $this = $(this);

            if ($this.hasClass("global")) {
                self.sort_key = "global";
            } else if ($this.hasClass("contest")) {
                self.sort_key = "c_" + $this.data("contest");
            } else if ($this.hasClass("task")) {
                self.sort_key = "t_" + $this.data("task");
            }

            // The new order takes effect with the rows sliding into their
            // new places (when the setting allows), at the slower sort
            // pace since the whole board reshuffles at once
            self.reorder_with_slides(self.sort, undefined, SORT_SLIDE_MS);

            $("col[data-sort_key=" + self.sort_key + "]", self.tcols_el).addClass("sort_key");
            $("tr td[data-sort_key=" + self.sort_key + "]", self.thead_el).addClass("sort_key");
            $("tr td[data-sort_key=" + self.sort_key + "]", self.tbody_el).addClass("sort_key");
        });

        self.sort_key = "global";
        self.make_body();

        // Set initial style
        $("col[data-sort_key=" + self.sort_key + "]", self.tcols_el).addClass("sort_key");
        $("tr td[data-sort_key=" + self.sort_key + "]", self.thead_el).addClass("sort_key");
        $("tr td[data-sort_key=" + self.sort_key + "]", self.tbody_el).addClass("sort_key");

        // Create callbacks for selection
        self.tbody_el.on("click", "td.sel", function () {
            DataStore.toggle_selected($(this).parent().data("user"));
        });

        $("#SelectionFilter_checkbox").click(function () {
            self.set_filtering($(this).prop("checked"));
        });

        self.update_filter_ui();

        // Create callbacks for UserPanel
        self.tbody_el.on("click", "td.name, td.user_id", function () {
            UserDetail.show($(this).parent().data("user"));
        });

        // Create callbacks for animation-end
        self.tbody_el.on('animationend', 'tr', function(event) {
            $(this).removeClass("score_up score_down");
        });

        // Fuck, WebKit!!
        self.tbody_el.on('webkitAnimationEnd', 'tr', function(event) {
            $(this).removeClass("score_up score_down");
        });

        // Cleanup for the playback effects (see the section further down)
        self.tbody_el.on("animationend", "td.score", function () {
            $(this).removeClass("cell_up cell_down");
        });
    };


    self.make_cols = function () {
        // We want some columns to have a fixed, constant width at all screen
        // sizes (i.e. the sel, rank and team columns) while having the other
        // columns scale accoring to the available horizontal space. Yet, we
        // also want these columns' widths to keep a certain ratio one to each
        // other, for example the task score, contest score and global score
        // columns should be in a 3:4:5 ratio. Since the number of columns is
        // not known beforehand, this is quite difficult to achieve.
        // We cannot specify all the widths using pixel sizes (or similar)
        // because when there are many tasks the table may overflow, and when
        // there are few tasks it may underflow (and, in such cases, the
        // remaining width is divided proportionally among all columns, thus
        // enlarging the constant width columns too). We cannot use relative
        // widths (i.e. using precent values) because it seems that some
        // versions of IE don't like it when the sum of the widths is greater
        // than 100% (and this may happen when there are many tasks).
        // We cannot use an 'auto' width on all columns because this would not
        // preserve the ratio among widths.
        // We cannot mix fixed/percent/auto widths because, depending on the
        // way we do it, the solution may not scale well at high resolutions or
        // it may again be difficult to keep the ratio that we want.
        // Also, I would like not to use JS or strange HTML constructions to
        // achieve this goal: it would be great if we could do this using just
        // simple CSS rules.
        // I couldn't find the perfect solution, so the one I'm implementing is
        // a bit of a compromise, which tries to mess as little as possible
        // with JS and HTML. So, at the moment, this is what we do: we set the
        // columns with fixed width to their fixed width (via CSS). We don't
        // define a width for all other columns, thus leaving them at their
        // default value: auto. Yet, we don't create a single <col/> element
        // for each column, but we create 3 for the task columns, 4 for the
        // contest columns, 5 for the global column, etc. Then we set the
        // colspan attribute of task cells to 3, of contest cells to 4, of
        // global cells to 5, etc. This way, since all <col/>s with a width of
        // 'auto' get the same computed width, we keep the 3:4:5 ratio and are
        // able to scale well at each screen size, while keeping the constant
    // width columns constant. (Note: we gave the name column a "width" of
    // 20 <col/> elements.)
        // Suggestion on other solution that get the same result and don't mess
        // this much with JS and HTML are extremely welcome!
        var result = " \
<col class=\"sel\"/> \
<col class=\"rank\"/> \
<col class=\"name\"/> <col/><col/><col/><col/><col/><col/><col/><col/><col/> \
<col/> <col/><col/><col/><col/><col/><col/><col/><col/><col/> \
<col class=\"user_id\"/> \
<col class=\"team\"/>";

        var contests = DataStore.contest_list;
        for (var i in contests) {
            var contest = contests[i];
            var c_id = contest["key"];

            var tasks = contest["tasks"];
            for (var j in tasks) {
                var task = tasks[j];
                var t_id = task["key"];

                result += " \
<col class=\"score task\" data-task=\"" + t_id + "\" data-sort_key=\"t_" + t_id + "\"/> <col/><col/>";
            }

            result += " \
<col class=\"score contest\" data-contest=\"" + c_id + "\" data-sort_key=\"c_" + c_id + "\"/> <col/><col/><col/>";
        }

        result += " \
<col class=\"score global\" data-sort_key=\"global\"/> <col/><col/><col/><col/>";

        return result;
    };


    self.make_head = function () {
        // See the comment in .make_cols() for the reason we use colspans.
        var result = " \
<tr> \
    <th class=\"sel\"></th> \
    <th class=\"rank\">Rank</th> \
    <th colspan=\"10\" class=\"f_name\">First Name</th> \
    <th colspan=\"10\" class=\"l_name\">Last Name</th> \
    <th class=\"user_id\">ID</th> \
    <th class=\"team\">Team</th>";

        var contests = DataStore.contest_list;
        for (var i in contests) {
            var contest = contests[i];
            var c_id = contest["key"];

            var tasks = contest["tasks"];
            for (var j in tasks) {
                var task = tasks[j];
                var t_id = task["key"];

                result += " \
    <th colspan=\"3\" class=\"score task\" data-task=\"" + t_id + "\" data-sort_key=\"t_" + t_id + "\"><abbr title=\"" + escapeHTML(task["name"]) + "\">" + escapeHTML(task["short_name"]) + "</abbr></th>";
            }

            result += " \
    <th colspan=\"4\" class=\"score contest\" data-contest=\"" + c_id + "\" data-sort_key=\"c_" + c_id + "\"><abbr title=\"" + escapeHTML(contest["name"]) + "\">" + escapeHTML(contest["name"]) + "</abbr></th>";
        }

        // MODIFICATION - IOI yyyy instead of global
        result += " \
    <th colspan=\"5\" class=\"score global\" data-sort_key=\"global\">" + "IOI " + DataStore.year + "</th> \
</tr>";

        return result;
    };


    self.make_body = function () {
        for (var u_id in DataStore.users) {
            var user = DataStore.users[u_id];
            user["row"] = $(self.make_row(user))[0];
            self.user_list.push(user);
        }

        self.sort();
    };


    // Whether the scoreboard only shows the selected users
    self.filtering = false;

    self.is_filtered_out = function (user) {
        return self.filtering && !(user["selected"] > 0);
    };

    self.set_filtering = function (flag) {
        // The surviving rows slide into their compacted (or restored)
        // places; rows that hide or reappear do so in place
        self.reorder_with_slides(function () {
            self.filtering = flag;

            for (const user of self.user_list) {
                $(user["row"]).toggleClass("filtered_out", self.is_filtered_out(user));
            }

            // Hiding or showing rows changes every measurement in the cache
            self.geometry = undefined;

            self.update_ranks();
            self.update_filter_ui();
            self.reposition_overlay_badges();
        });
    };

    self.selected_count = function () {
        var count = 0;

        for (const user of self.user_list) {
            if (user["selected"] > 0) {
                count += 1;
            }
        }

        return count;
    };

    self.update_filter_ui = function () {
        var count = self.selected_count();

        // Filtering when nothing is selected would show an empty scoreboard
        $("#SelectionFilter")
            .toggleClass("on", self.filtering)
            .toggleClass("disabled", count == 0)
            .attr("title", count == 0 ? "Select contestants first" : null);
        $("#SelectionFilter_checkbox")
            .prop("checked", self.filtering)
            .prop("disabled", count == 0);
        $("#SelectionFilter_count").text(count > 0 ? count : "");
    };


    // The width of "First " in the scoreboard's font, measured with a
    // canvas (no layout involved). The name spacer (see make_name_cell)
    // subtracts it from the fixed last-name column offset.
    self.first_name_width = function (f_name, weight) {
        if (self.name_measure_ctx === undefined) {
            self.name_measure_ctx =
                document.createElement("canvas").getContext("2d");
            var style = window.getComputedStyle(self.tbody_el[0]);
            self.name_measure_font = style.fontSize + " " + style.fontFamily;
        }
        self.name_measure_ctx.font = weight + self.name_measure_font;
        return self.name_measure_ctx.measureText(f_name + " ").width;
    };

    // The first and last name look like two aligned columns but live in
    // one cell, as a single run of plain inline text, so that the
    // browser's find-in-page can match a full "First Last" search:
    // browsers never match text that spans two table cells (each cell is
    // its own text block, and Chrome breaks matches even across
    // inline-blocks that contain text). The two-column look comes from an
    // empty inline-block spacer between the names — empty atomic inlines
    // are the one thing that provably doesn't break the match — whose
    // per-row width places the last name at the former column boundary.
    // The measured width of "First " is handed to the stylesheet via the
    // --fw custom property (--fw_b is the bold variant, for while the row
    // is selected); see td.name .name_gap in Ranking.css for the rest of
    // the math.
    self.make_name_cell = function (user) {
        return "<td colspan=\"20\" class=\"name\" style=\"--fw: " +
               self.first_name_width(user["f_name"], "").toFixed(2) +
               "px; --fw_b: " +
               self.first_name_width(user["f_name"], "bold ").toFixed(2) +
               "px\">" + escapeHTML(user["f_name"]) +
               "<span class=\"name_gap\"></span> " +
               escapeHTML(user["l_name"]) + "</td>";
    };

    self.make_row = function (user) {
        // See the comment in .make_cols() for the reason we use colspans.
        var result = " \
<tr class=\"user" + (user["selected"] > 0 ? " selected color" + user["selected"] : "") + (self.is_filtered_out(user) ? " filtered_out" : "") + "\" data-user=\"" + user["key"] + "\"> \
    <td class=\"sel\"></td> \
    <td class=\"rank medal-" + Config.get_medal(user["rank"]) + "\"><span class=\"rank_label\">" + self.format_rank(user) + "</span></td> \
    " + self.make_name_cell(user) + " \
    <td class=\"user_id\">" + user["display_key"] + "</td>";

        if (user['team']) {
            if (DataStore.asset_config && DataStore.asset_config["noflags"])
                result += " \
            <td class=\"team\">" + user["team"] + "</td>";
            else
                result += " \
    <td class=\"team\"><img src=\"" + Config.get_flag_url(user["team"]) + "\" title=\"" + DataStore.teams[user["team"]]["name"] + "\" /></td>";
        } else {
            result += " \
    <td class=\"team\"></td>";
        }

        var contests = DataStore.contest_list;
        for (var i in contests) {
            var contest = contests[i];
            var c_id = contest["key"];

            var tasks = contest["tasks"];
            for (var j in tasks) {
                var task = tasks[j];
                var t_id = task["key"];

                var score_class = self.get_score_class(user["t_" + t_id], task["max_score"]);
                result += " \
    <td colspan=\"3\" class=\"score task " + score_class + "\" data-task=\"" + t_id + "\" data-sort_key=\"t_" + t_id + "\">" + round_to_str(user["t_" + t_id], task["score_precision"]) + "</td>";
            }

            var score_class = self.get_score_class(user["c_" + c_id], contest["max_score"]);
            result += " \
    <td colspan=\"4\" class=\"score contest " + score_class + "\" data-contest=\"" + c_id + "\" data-sort_key=\"c_" + c_id + "\">" + round_to_str(user["c_" + c_id], contest["score_precision"]) + "</td>";
        }

        var score_class = self.get_score_class(user["global"], DataStore.global_max_score);
        result += " \
    <td colspan=\"5\" class=\"score global " + score_class + "\" data-sort_key=\"global\">" + round_to_str(user["global"], DataStore.global_score_precision) + "</td> \
</tr>";

        return result;
    };


    self.get_score_class = function (score, max_score) {
        if (score <= 0) {
            return "score_0";
        } else if (score >= max_score) {
            return "score_100";
        } else {
            var rel_score = parseInt(score / max_score * 10) * 10;
            return "score_" + rel_score + "_" + (rel_score + 10);
        }
    };


    // We keep a sorted list of user that represent the current order of the
    // scoreboard. In particular we sort using these keys:
    // - the score in the current active column
    // - the global score
    // - the last name
    // - the first name
    // - the key
    self.user_list = new Array();


    // Compare two users. Returns -1 if "a < b" or +1 if "a >= b"
    // (where a < b means that a shoud go above b in the scoreboard)
    self.compare_users = function (a, b) {
        var sort_key = self.sort_key;
        if ((a[sort_key] > b[sort_key]) || ((a[sort_key] == b[sort_key]) &&
           ((a["global"] > b["global"]) || ((a["global"] == b["global"]) &&
           ((a["l_name"] < b["l_name"]) || ((a["l_name"] == b["l_name"]) &&
           ((a["f_name"] < b["f_name"]) || ((a["f_name"] == b["f_name"]) &&
           (a["key"] <= b["key"]))))))))) {
            return -1;
        } else {
            return +1;
        }
    };


    // Suppose the scoreboard is correctly sorted except for the given user.
    // Move this user (up or down) to put it in their correct position.
    self.move_user = function (user) {
        var list = self.user_list;
        var compare = self.compare_users;

        var list_l = list.length;
        var i = parseInt(user["index"]);

        if (i > 0 && compare(user, list[i-1]) == -1) {
            // Move up

            while (i > 0 && compare(user, list[i-1]) == -1) {
                list[i] = list[i-1];
                list[i]["index"] = i;
                i -= 1;
            }
            list[i] = user;
            user["index"] = i;

            if (i == 0) {
                self.tbody_el.prepend(user["row"]);
            } else {
                self.tbody_el.children("tr.user[data-user=" + list[i-1]["key"] + "]").after(user["row"]);
            }
        } else if (i < list_l-1 && compare(list[i+1], user) == -1) {
            // Move down

            while (i < list_l-1 && compare(list[i+1], user) == -1) {
                list[i] = list[i+1];
                list[i]["index"] = i;
                i += 1;
            }
            list[i] = user;
            user["index"] = i;

            if (i == list_l-1) {
                self.tbody_el.append(user["row"]);
            } else {
                self.tbody_el.children("tr.user[data-user=" + list[i+1]["key"] + "]").before(user["row"]);
            }
        }
    };


    // The users the scoreboard currently shows, in user_list order
    self.visible_users = function () {
        if (!self.filtering) {
            return self.user_list;
        }
        return self.user_list.filter(u => !self.is_filtered_out(u));
    };

    // Local ranks (as displayed under the current sorting and filtering) for
    // all users at once, keyed by user id. The timeline snapshots this
    // before and after a playback batch to compute rank deltas.
    self.get_local_ranks = function () {
        const sort_key = self.sort_key;
        const sorted = self.visible_users().slice()
            .sort((a, b) => b[sort_key] - a[sort_key]);

        var result = new Object();
        var rank = 1;
        for (var i = 0; i < sorted.length; i += 1) {
            if (i > 0 && sorted[i][sort_key] < sorted[i - 1][sort_key]) {
                rank = i + 1;
            }
            result[sorted[i]["key"]] = rank;
        }
        return result;
    };

    // Get the rank for the current scoreboard order
    self.get_local_rank = function (user) {
        const sort_key = self.sort_key;
        return self.visible_users()
            .filter(u => u[sort_key] > user[sort_key]).length + 1;
    }

    // Get what the rank should look like for the given user. The local rank
    // can be passed in when it's already known (batch updates compute all of
    // them at once, which is much cheaper than one get_local_rank per user).
    self.format_rank = function (user, local_rank) {
        const global_rank = user.rank;
        if (local_rank === undefined) {
            local_rank = self.get_local_rank(user);
        }

        if (global_rank === local_rank || !Settings.get("global_ranks")) {
            return local_rank.toString();
        } else {
            return `${local_rank} (${global_rank})`;
        }
    }

    self.update_ranks = function () {
        var local_ranks = self.get_local_ranks();
        for (const user of self.user_list) {
            // Filtered-out rows are hidden, so their cells can wait until
            // the filter is turned off
            if (local_ranks[user["key"]] !== undefined) {
                self.update_rank(user, local_ranks[user["key"]]);
            }
        }
    }

    // Update the rank cell for the given user. Only the label span is
    // rewritten: the cell also hosts the transient rank-delta badge, which
    // a .text() on the cell itself would destroy. The last written text and
    // class are cached on the user so unchanged cells aren't touched at all
    // (this runs for every user on every replay tick of the timeline).
    self.update_rank = function (user, local_rank) {
        var text = self.format_rank(user, local_rank);
        var cls = "rank medal-" + Config.get_medal(user["rank"]);

        if (user["rank_cell_text"] === text && user["rank_cell_class"] === cls) {
            return;
        }
        user["rank_cell_text"] = text;
        user["rank_cell_class"] = cls;

        var $rank = $(user.row).children("td.rank");
        $rank.attr("class", cls);
        $rank.children(".rank_label").text(text);
    }

    // Rewrite the score cells of the given user that actually changed. The
    // cells and their static parameters are resolved once per user, and the
    // last written score is remembered, since this runs for every dirty user
    // on every replay tick.
    self.refresh_user = function (user) {
        if (user["score_cells"] === undefined) {
            user["score_cells"] = [];
            $(user["row"]).children("td.score").each(function () {
                var $this = $(this);
                var precision, max_score;

                if ($this.hasClass("global")) {
                    precision = DataStore.global_score_precision;
                    max_score = DataStore.global_max_score;
                } else if ($this.hasClass("contest")) {
                    var contest = DataStore.contests[$this.data("contest")];
                    precision = contest["score_precision"];
                    max_score = contest["max_score"];
                } else {
                    var task = DataStore.tasks[$this.data("task")];
                    precision = task["score_precision"];
                    max_score = task["max_score"];
                }

                // The heatmap class the cell currently carries; the score is
                // left unknown so that the first pass rewrites every cell
                var score_class = null;
                for (const cls of this.classList) {
                    if (cls.lastIndexOf("score_", 0) == 0) {
                        score_class = cls;
                        break;
                    }
                }

                user["score_cells"].push({
                    "cell": this,
                    "sort_key": $this.data("sort_key"),
                    "precision": precision,
                    "max_score": max_score,
                    "score": null,
                    "score_class": score_class
                });
            });
        }

        for (const entry of user["score_cells"]) {
            var score = user[entry["sort_key"]];
            if (score === entry["score"]) {
                continue;
            }
            entry["score"] = score;

            var score_class = self.get_score_class(score, entry["max_score"]);
            if (score_class !== entry["score_class"]) {
                if (entry["score_class"] !== null) {
                    entry["cell"].classList.remove(entry["score_class"]);
                }
                entry["cell"].classList.add(score_class);
                entry["score_class"] = score_class;
            }

            entry["cell"].textContent = round_to_str(score, entry["precision"]);
        }
    }

    // Sort the scoreboard using the column with the given index.
    self.sort = function () {
        var list = self.user_list;

        list.sort(self.compare_users);

        // All the local ranks in one sweep, rather than one O(n) scan each
        var local_ranks = self.get_local_ranks();

        // Only move the rows that are out of place: re-inserting a row
        // restarts its CSS animations, so rows that didn't move must not be
        // touched (and this is much cheaper during playback, too)
        var tbody = self.tbody_el[0];
        for (const [idx, user] of list.entries()) {
            user["index"] = idx;
            if (tbody.children[idx] !== user["row"]) {
                tbody.insertBefore(user["row"], tbody.children[idx] || null);
            }
            // Filtered-out rows are hidden: their rank cells are refreshed
            // by update_ranks when the filter is turned off
            if (local_ranks[user["key"]] !== undefined) {
                self.update_rank(user, local_ranks[user["key"]]);
            }
        }

        self.reposition_overlay_badges();
    };


    // This callback is called by the DataStore when a user is created.
    self.create_user = function (u_id, user) {
        var $row = $(self.make_row(user));
        $row.children("td[data-sort_key=" + self.sort_key + "]").addClass("sort_key");

        user["row"] = $row[0];
        user["index"] = self.user_list.length;
        self.user_list.push(user);

        self.tbody_el.append($row);
        // The row will be at the bottom (since it has a score of zero and thus
        // the maximum rank), but we may still need to sort it due to other
        // users having that score and the sort-by-name clause.
        self.move_user(user);
    };


    // This callback is called by the DataStore when a user is updated.
    // It updates only its basic information (first name, last name and team).
    self.update_user = function (u_id, old_user, user) {
        var $row = $(old_user["row"]);

        user["row"] = old_user["row"];
        user["index"] = old_user["index"];
        self.user_list.splice(old_user["index"], 1, user);
        delete old_user["row"];
        delete old_user["index"];

        $row.children("td.name").replaceWith(self.make_name_cell(user));

        if (user["team"]) {
            $row.children(".team").html("<img src=\"" + Config.get_flag_url(user["team"]) + "\" title=\"" + DataStore.teams[user["team"]]["name"] + "\" />");
        } else {
            $row.children(".team").text("");
        }
    };


    // This callback is called by the DataStore when a user is deleted.
    self.delete_user = function (u_id, old_user) {
        var $row = $(old_user["row"]);

        self.user_list.splice(old_user["index"], 1);
        delete old_user["row"];
        delete old_user["index"];

        $row.remove();
    };


    // This callback is called by the DataStore when a user changes score.
    self.score_handler = function (u_id, user, t_id, task, delta) {
        var $row = $(user["row"]);

        // TODO improve this method: avoid walking over all cells

        $row.children("td.score").each(function () {
            var $this = $(this);

            var score = user[$this.data("sort_key")];

            if ($this.hasClass("global")) {
                var max_score = DataStore.global_max_score;
                $this.text(round_to_str(score, DataStore.global_score_precision));
            } else if ($this.hasClass("contest")) {
                var contest = DataStore.contests[$this.data("contest")];
                var max_score = contest["max_score"];
                $this.text(round_to_str(score, contest["score_precision"]));
            } else if ($this.hasClass("task")) {
                var task = DataStore.tasks[$this.data("task")];
                var max_score = task["max_score"];
                $this.text(round_to_str(score, task["score_precision"]));
            }

            // TODO we could user a data-* attribute to store the score class

            var score_class = self.get_score_class(score, max_score);
            $this.removeClass("score_0 score_0_10 score_10_20 score_20_30 score_30_40 score_40_50 score_50_60 score_60_70 score_70_80 score_80_90 score_90_100 score_100");
            $this.addClass(score_class);
        });

        self.move_user(user);

        // Restart CSS animation
        $row.removeClass("score_up score_down");
        if (delta > 0) {
            $row.addClass("score_up");
        } else if (delta < 0) {
            $row.addClass("score_down");
        }
    };


    // This callback is called by the DataStore when a user changes rank.
    // update_rank keeps the cached cell text and medal class coherent.
    self.rank_handler = function (u_id, user) {
        self.update_rank(user);
    };


    self.select_handler = function (u_id, color) {
        var $row = $(DataStore.users[u_id]["row"]);

        // TODO we could user a data-* attribute to store the color

        if (color != 0) {
            $row.addClass("selected color" + color);
        } else {
            $row.removeClass("selected color1 color2 color3 color4 color5 color6 color7 color8");
        }

        if (self.filtering) {
            // Deselecting the last user turns the filter off, as an empty
            // scoreboard would leave no way to select anyone again
            self.set_filtering(self.selected_count() > 0);
        } else {
            self.update_filter_ui();
        }
    };

    self.scroll_into_view = function (u_id) {
        var $row = $("tr.user[data-user=" + u_id + "]", self.tbody_el);
        var $frame = $("#InnerFrame");
        var scroll = $row.position().top + $row.height() / 2 - $frame.height() / 2;
        $frame.scrollTop(scroll);
    };


    ////// Playback effects
    //
    // Transient, viewport-gated bits of feedback used by the timeline while
    // replaying the contest: a flash on a score cell that changed, a little
    // rank-delta badge, and rows sliding to their new position (FLIP).

    // Row positions are computed from the sorted index and a once-measured
    // row height instead of reading tr.offsetTop: layout reads between the
    // DOM writes of a replay tick force a synchronous reflow of the whole
    // table, which dominated the profile on slow devices
    self.measure_geometry = function () {
        var frame = $("#InnerFrame")[0];
        var tbody = self.tbody_el[0];
        // With a filter active the hidden rows take up no space, so only
        // the visible ones count towards the measurements (user_list order
        // matches the DOM order, so the first visible user's row is the
        // first visible row)
        var visible = self.visible_users();
        var first_row = visible.length > 0 ? visible[0]["row"] : null;
        var row_count = visible.length;

        // The row height must keep its fractional part (offsetHeight rounds
        // to an integer): index * height accumulates the rounding error to
        // whole rows' worth by the bottom of the table, e.g. when centering
        // on a followed row. Averaging over the whole body also irons out
        // per-row rounding of borders.
        var row_height = 0;
        if (row_count > 0) {
            row_height = tbody.getBoundingClientRect().height / row_count;
        }

        var frame_rect = frame.getBoundingClientRect();
        // Where the badge gutter sits on screen, for the overlay badges: to
        // the left of the selection-checkbox column of whatever row is at
        // the top
        var sel_cell = first_row !== null ?
                       first_row.querySelector("td.sel") : null;
        var sel_rect = sel_cell !== null ?
                       sel_cell.getBoundingClientRect() : {"left": 0};

        self.geometry = {
            "table_top": $("#Scoreboard")[0].offsetTop,
            "row_base": first_row !== null ? first_row.offsetTop : 0,
            "row_height": row_height,
            "frame": frame,
            "frame_height": frame.clientHeight,
            "frame_top": frame_rect.top,
            "frame_bottom": frame_rect.bottom,
            // Where the sticky header's bottom edge sits once it is stuck
            // to the top of the frame: rows above it are hidden behind it
            "header_bottom": frame_rect.top +
                             self.thead_el[0].getBoundingClientRect().height,
            "gutter_right": sel_rect.left - 5
        };
    };

    // The offset of the user's row from the top of the table
    self.row_offset = function (user) {
        return self.geometry["row_base"] +
               user["index"] * self.geometry["row_height"];
    };

    // Like row_offset, but valid with a filter active too: hidden rows keep
    // their sorted index, so indexes then no longer map to positions and the
    // layout is read instead (the filtered table is small, which keeps the
    // forced reflow affordable)
    self.row_top = function (user) {
        return self.filtering ? user["row"].offsetTop : self.row_offset(user);
    };

    // The currently visible vertical span, in row-offset coordinates. Call
    // it before mutating the DOM, while the layout is still clean.
    self.visible_range = function () {
        if (self.geometry === undefined) {
            self.measure_geometry();
        }

        var top = self.geometry["frame"].scrollTop - self.geometry["table_top"];
        return {
            "top": top,
            "bottom": top + self.geometry["frame_height"]
        };
    };

    self.is_row_visible = function (user, range) {
        // A hidden row reads offsetTop 0, which could pass the range check
        if (self.is_filtered_out(user)) {
            return false;
        }
        var top = self.row_top(user);
        return top + self.geometry["row_height"] > range["top"] &&
               top < range["bottom"];
    };

    // One-shot flash on the task cell whose score just changed. The flash
    // is an inset shadow so the cell's own background shows through as it
    // fades; it's driven with the Web Animations API since restarting a CSS
    // animation needs a forced reflow, which is far too slow to do per cell
    // per replay tick.
    self.flash_cell = function (user, t_id, direction) {
        var cells = user["score_cells"];
        if (cells === undefined) {
            return;
        }

        var sort_key = "t_" + t_id;
        for (const entry of cells) {
            if (entry["sort_key"] !== sort_key) {
                continue;
            }

            var color = direction > 0 ? "138, 226, 52" : "239, 41, 41";
            if (entry["flash"] !== undefined) {
                entry["flash"].cancel();
            }
            entry["flash"] = entry["cell"].animate([
                {"boxShadow": "inset 0 0 0 2em rgba(" + color + ", 0.65)"},
                {"boxShadow": "inset 0 0 0 2em rgba(" + color + ", 0)"}
            ], {"duration": 500, "easing": "ease-out"});
            return;
        }
    };

    // A fading "climbed/dropped n places" badge, shown in the gutter left
    // of the row while replaying. The badges live in one fixed-position
    // container over the page rather than inside the table rows: on iOS
    // WebKit any composited descendant inside the table (even a single
    // static one) puts the table into an expensive compositing
    // configuration that every replay tick pays for, while the same
    // animation in a layer with no table ancestry is cheap.
    self.init_delta_overlay = function () {
        self.overlay_el = document.createElement("div");
        self.overlay_el.id = "RankDeltaOverlay";
        document.body.appendChild(self.overlay_el);
        // Badges must track their rows when the scoreboard scrolls, too
        $("#InnerFrame").on("scroll", self.reposition_overlay_badges);
        // Badges are recycled: a live one is reused for its own row, and a
        // finished one goes back to the pool rather than being destroyed
        self.overlay_pool = new Array();
        self.overlay_live = new Array();
    };

    self.overlay_badge = function () {
        if (self.overlay_el === undefined) {
            self.init_delta_overlay();
        }
        var badge = self.overlay_pool.pop();
        if (badge === undefined) {
            badge = document.createElement("span");
            self.overlay_el.appendChild(badge);
        }
        return badge;
    };

    // Place a badge at its row's current position on screen, hiding it when
    // the row is scrolled out of the scoreboard frame (or behind the sticky
    // header). Positions come from the cached row geometry, never from a
    // layout read.
    self.place_overlay_badge = function (entry) {
        if (self.geometry === undefined) {
            self.measure_geometry();
        }
        var geometry = self.geometry;
        var top = geometry["frame_top"] +
                  self.row_top(entry["user"]) + geometry["table_top"] -
                  geometry["frame"].scrollTop +
                  geometry["row_height"] / 2;
        var visible = !self.is_filtered_out(entry["user"]) &&
                      top > geometry["header_bottom"] &&
                      top < geometry["frame_bottom"];

        // The badge's right edge sits at the gutter, vertically centered
        entry["badge"].style.transform =
            "translate(" + geometry["gutter_right"] + "px, " + top + "px) " +
            "translate(-100%, -50%)";
        entry["badge"].style.visibility = visible ? "" : "hidden";
    };

    // Keep live badges glued to their rows as the standings reorder or the
    // scoreboard scrolls
    self.reposition_overlay_badges = function () {
        if (self.overlay_live === undefined) {
            return;
        }
        for (const entry of self.overlay_live) {
            self.place_overlay_badge(entry);
        }
    };

    // A badge younger than this cannot be cut short by movement against
    // it: a jump must stay readable for a moment even if the row slides
    // right back down (the slide is shown once the badge has aged)
    const MIN_BADGE_MS = 1000;

    // Cut the user's live badge short, so that the next movement starts a
    // fresh one counting from scratch (used by the timeline when a passive
    // drop-batching window rolls over). Respects the minimum age: a young
    // badge stays up, and further movement folds into it instead.
    self.end_rank_delta = function (user) {
        var entry = user["delta_entry"];
        if (entry !== undefined && entry["anim"].playState === "running" &&
            entry["anim"].currentTime >= MIN_BADGE_MS) {
            entry["anim"].cancel();
        }
    };

    // The optional duration stretches the fade: active badges use the
    // default, while the passive-drop badges last as long as their
    // batching window, so that a sustained slide keeps one badge up
    // rather than pulsing new ones (see Timeline)
    self.show_rank_delta = function (user, old_rank, new_rank, duration) {
        var entry = user["delta_entry"];
        var active = entry !== undefined && entry["anim"].playState === "running";

        // Movement against the badge's displayed direction starts a fresh
        // badge instead of netting out (a +10 bounce during a slide must
        // read +10, not shrink the visible minus), and also resets the
        // drop-batching window (see Timeline)
        if (active) {
            var shown = user["delta_from"] - user["delta_last"];
            var fresh = old_rank - new_rank;
            if (fresh != 0 && (fresh > 0) != (shown > 0)) {
                // A young badge is left up untouched: the jump it shows
                // must stay readable even if the row moves back right
                // away (a passive slide isn't lost — its batching window
                // keeps counting, and a later tick will show it)
                if (entry["anim"].currentTime < MIN_BADGE_MS) {
                    return;
                }
                entry["anim"].cancel();
                active = false;
                user["drop_start"] = undefined;
            }
        }

        // While a badge is showing, fold further movement in its own
        // direction into it in place rather than restarting it (rapid rank
        // changes would otherwise flash constantly)
        var from = active ? user["delta_from"] : old_rank;
        if (!active) {
            user["delta_from"] = from;
        }
        user["delta_last"] = new_rank;
        var delta = from - new_rank;

        if (delta == 0) {
            if (active) {
                entry["anim"].cancel();
            }
            return;
        }

        if (!active) {
            var badge = self.overlay_badge();
            entry = {"user": user, "badge": badge};
            user["delta_entry"] = entry;
            self.overlay_live.push(entry);

            entry["anim"] = badge.animate([
                {"opacity": 0},
                {"opacity": 1, "offset": 0.15},
                {"opacity": 1, "offset": 0.7},
                {"opacity": 0}
            ], {"duration": duration || 2000, "easing": "ease-out"});
            entry["anim"].onfinish = entry["anim"].oncancel = function () {
                var index = self.overlay_live.indexOf(entry);
                if (index !== -1) {
                    self.overlay_live.splice(index, 1);
                }
                badge.style.visibility = "hidden";
                self.overlay_pool.push(badge);
                if (user["delta_entry"] === entry) {
                    user["delta_entry"] = undefined;
                }
            };
        }

        entry["badge"].className = delta > 0 ? "rank_delta up" : "rank_delta down";
        entry["badge"].textContent =
            (delta > 0 ? "\u25B2" : "\u25BC") + Math.abs(delta);
        self.place_overlay_badge(entry);
    };

    // Record every row's vertical position; pass the result to animate_sort
    // after re-sorting to slide the rows from where they were
    self.measure_rows = function () {
        var result = new Object();
        for (const user of self.user_list) {
            // A hidden row reads offsetTop 0, not a position to slide from
            if (self.is_filtered_out(user)) {
                continue;
            }
            result[user["key"]] = user["row"].offsetTop;
        }
        return result;
    };

    // The sorted index of every row, for animate_playback_sort: the cheap
    // stand-in for measure_rows during playback, where index * row height
    // gives the position without any layout read
    self.snapshot_indices = function () {
        var result = new Object();
        for (const user of self.user_list) {
            result[user["key"]] = user["index"];
        }
        return result;
    };

    // How long a row takes to slide into its new place
    const SLIDE_MS = 250;

    // Changing the sort column reshuffles the whole board at once, which
    // is easier to follow at half speed
    const SORT_SLIDE_MS = 2 * SLIDE_MS;

    // Slide a row into its place from delta pixels away (FLIP). If an
    // earlier slide is still in flight, the row continues from where it
    // visually is: a mid-animation retarget (say 200 -> 10 becoming -> 75
    // when the row is passing 50) reads 200 -> 50 -> 75, never snapping.
    // Driven with the Web Animations API: the sort's insertBefore would
    // kill a CSS transition on a moved row, while a live WAAPI animation
    // survives the move and can be sampled for the in-flight offset.
    self.slide_row = function (user, delta, duration) {
        if (duration === undefined) {
            duration = SLIDE_MS;
        }
        if (self.reduced_motion === undefined) {
            self.reduced_motion =
                window.matchMedia("(prefers-reduced-motion: reduce)");
        }
        if (self.reduced_motion.matches) {
            return;
        }

        var row = user["row"];
        var slide = user["slide"];
        if (slide !== undefined && slide.playState === "running") {
            // Where the interrupted slide visually left the row: the
            // computed transform is the animation's current frame
            var transform = window.getComputedStyle(row).transform;
            var matrix = transform.match(/matrix\(([^)]+)\)/);
            if (matrix !== null) {
                delta += parseFloat(matrix[1].split(",")[5]);
            }
            slide.cancel();
        }

        if (delta == 0) {
            return;
        }

        user["slide"] = row.animate(
            [{"transform": "translateY(" + delta + "px)"},
             {"transform": "none"}],
            {"duration": duration, "easing": "ease-out"});
    };

    // Everything that reaches here is a deliberate gesture (a sort click,
    // a filter toggle, a timeline jump or scrub tick), so even a full
    // reshuffle animates: unlike the replay-tick variant below there is no
    // cap, and the visibility filter bounds the work to about two
    // viewports' worth of rows anyway.
    self.animate_sort = function (before, duration) {
        var range = self.visible_range();
        var moved = new Array();

        for (const user of self.user_list) {
            var row = user["row"];
            // Rows hidden on either side of the change appear (or vanish)
            // in place: there is no old position to come from, or no
            // visible destination to slide to
            if (before[user["key"]] === undefined ||
                self.is_filtered_out(user)) {
                continue;
            }

            var start = before[user["key"]];
            var height = row.offsetHeight;

            // Only rows that are (or were) in the viewport get to slide
            var was_visible = start + height > range["top"] &&
                              start < range["bottom"];
            if (!was_visible && !self.is_row_visible(user, range)) {
                continue;
            }

            // A row coming from screens away would cross the viewport in a
            // frame or two, invisible: entering rows are clamped to start
            // just off the nearer edge, so they visibly whoosh in rather
            // than teleporting (mirrors animate_playback_sort)
            start = Math.min(start, range["bottom"] + height);
            start = Math.max(start, range["top"] - 2 * height);

            var delta = start - row.offsetTop;
            if (delta == 0) {
                continue;
            }

            moved.push([user, delta]);
        }

        for (const [user, delta] of moved) {
            self.slide_row(user, delta, duration);
        }
    };

    // Run a mutation that moves rows around (a new sort key, a filter
    // toggle, a timeline jump) and slide them from where they were. Every
    // measured reorder funnels through here, so the row_slides setting is
    // consulted in one place; callers with extra conditions of their own
    // (the timeline, whose playback frames answer to the nested
    // playback_slides setting instead) pass the whole verdict as
    // `enabled`, and callers whose slides read better slower (the sort
    // clicks) pass a `duration`.
    self.reorder_with_slides = function (mutate, enabled, duration) {
        if (enabled === undefined) {
            enabled = Settings.get("row_slides");
        }
        var before = enabled ? self.measure_rows() : null;
        mutate();
        if (before !== null) {
            self.animate_sort(before, duration);
        }
    };

    // The playback variant of animate_sort: pre- and post-sort positions
    // are derived from the sorted indexes and the once-measured row height
    // rather than from offsetTop, since a layout read on every replay tick
    // is what the geometry cache exists to avoid.
    //
    // The deltas are viewport-space: scroll_delta is how far the follow
    // recenter scrolled the frame within this tick, and folding it in
    // makes every row slide from where it was *on screen*. A centered
    // followed row nets out to zero (it stays pinned while the standings
    // flow past it), and rows that didn't reorder glide up smoothly
    // instead of jumping a row's worth with the scroll.
    self.animate_playback_sort = function (old_indices, range, scroll_delta) {
        // With a filter active the indexes don't map to positions (hidden
        // rows still hold an index), so playback slides sit out
        if (self.filtering || self.geometry === undefined) {
            return;
        }

        var base = self.geometry["row_base"];
        var height = self.geometry["row_height"];
        var viewport = range["bottom"] - range["top"];
        var moved = new Array();

        for (const user of self.user_list) {
            var old_idx = old_indices[user["key"]];
            if (old_idx === undefined) {
                continue;
            }

            var old_top = base + old_idx * height;
            var new_top = base + user["index"] * height;
            var delta = (old_top - new_top) + scroll_delta;

            // Sub-pixel remainders (the recenter rounds its scroll target)
            // aren't worth an animation
            if (Math.abs(delta) < 1) {
                continue;
            }

            // Where the slide starts and ends on screen (0 = viewport top;
            // with scroll_delta folded in, "final + delta" is exactly the
            // row's old on-screen position)
            var final_visual = new_top - range["top"];
            var start_visual = final_visual + delta;

            // A row coming from screens away would cross the viewport in a
            // frame or two, invisible: entering rows are clamped to start
            // just off the nearer edge, so an overtaker visibly whooshes
            // in rather than teleporting
            start_visual = Math.min(start_visual, viewport + height);
            start_visual = Math.max(start_visual, -2 * height);
            delta = start_visual - final_visual;

            // Only slides whose path crosses the viewport matter; this
            // also admits pass-throughs (a row jumping from below the view
            // to above it), which the endpoints alone would both miss
            var low = Math.min(start_visual, final_visual);
            var high = Math.max(start_visual, final_visual) + height;
            if (high <= 0 || low >= viewport) {
                continue;
            }

            moved.push([user, delta]);
        }

        if (moved.length == 0 || moved.length > 40) {
            return;
        }

        for (const [user, delta] of moved) {
            self.slide_row(user, delta);
        }
    };
};
