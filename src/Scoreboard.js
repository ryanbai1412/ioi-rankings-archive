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

var escapeHTML = (function() {
    var escapeMap = {
        '&' : '&amp;',
        '<' : '&lt;',
        '>' : '&gt;',
        '"' : '&quot;',
        "'" : '&#x27;',
        '/' : '&#x2F;',
        '`' : '&#x60;'
    };
    var escapeHTML = function(str) {
        return String(str).replace(/[&<>"'\/`]/g, function(ch) {
            return escapeMap[ch];
        });
    };
    return escapeHTML;
})();

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
        });

        Settings.on_change(function (name) {
            if (name === "global_ranks") {
                self.update_ranks();
            }
            if (name === "diag") {
                self.apply_diag();
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

            self.sort();

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
        self.tbody_el.on("click", "td.f_name, td.l_name, td.user_id", function () {
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

        self.tbody_el.on("transitionend", "tr", function () {
            this.style.transition = "";
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
        // width columns constant. (Note: we gave the first_ and last_name
        // columns a "width" of 10 <col/> elements.)
        // Suggestion on other solution that get the same result and don't mess
        // this much with JS and HTML are extremely welcome!
        var result = " \
<col class=\"sel\"/> \
<col class=\"rank\"/> \
<col class=\"f_name\"/> <col/><col/><col/><col/><col/><col/><col/><col/><col/> \
<col class=\"l_name\"/> <col/><col/><col/><col/><col/><col/><col/><col/><col/> \
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
        self.apply_diag();
    };


    // Whether the scoreboard only shows the selected users
    self.filtering = false;

    self.is_filtered_out = function (user) {
        return self.filtering && !(user["selected"] > 0);
    };

    self.set_filtering = function (flag) {
        self.filtering = flag;

        for (const user of self.user_list) {
            $(user["row"]).toggleClass("filtered_out", self.is_filtered_out(user));
        }

        self.update_ranks();
        self.update_filter_ui();
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


    self.make_row = function (user) {
        // See the comment in .make_cols() for the reason we use colspans.
        var result = " \
<tr class=\"user" + (user["selected"] > 0 ? " selected color" + user["selected"] : "") + (self.is_filtered_out(user) ? " filtered_out" : "") + "\" data-user=\"" + user["key"] + "\"> \
    <td class=\"sel\"></td> \
    <td class=\"rank medal-" + Config.get_medal(user["rank"]) + "\"><span class=\"rank_label\">" + self.format_rank(user) + "</span><span class=\"rank_delta\"></span></td> \
    <td colspan=\"10\" class=\"f_name\">" + escapeHTML(user["f_name"]) + "</td> \
    <td colspan=\"10\" class=\"l_name\">" + escapeHTML(user["l_name"]) + "</td> \
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


    // Local ranks (as displayed under the current sorting and filtering) for
    // all users at once, keyed by user id. The timeline snapshots this
    // before and after a playback batch to compute rank deltas.
    self.get_local_ranks = function () {
        const sort_key = self.sort_key;
        const list = self.filtering
            ? self.user_list.filter(u => !self.is_filtered_out(u))
            : self.user_list;

        const sorted = list.slice().sort((a, b) => b[sort_key] - a[sort_key]);

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
        const list = self.filtering
            ? self.user_list.filter(u => !self.is_filtered_out(u))
            : self.user_list;
        return list.filter(u => u[sort_key] > user[sort_key]).length + 1;
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
        // Diagnostic mode: rank changes leave the rows where they are, to
        // test whether reordering the rows is what makes the badge
        // animations expensive
        if (Settings.get_choice("diag", "none") == "freeze" &&
            self.tbody_el[0].childElementCount > 0) {
            return;
        }

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

    // The "composited table descendant" and "animate body-level span"
    // diagnostic modes from the settings panel, for isolating what makes
    // badge animations expensive on iOS WebKit
    self.apply_diag = function () {
        var diag = Settings.get_choice("diag", "none");

        // A permanently composited (but invisible and static) element
        // inside one table row, present through the whole replay
        var probe = self.user_list.length > 0 ?
                    $(self.user_list[0]["row"]).children("td.rank")
                        .children(".rank_delta")[0] : undefined;
        if (probe !== undefined) {
            probe.style.transform =
                diag == "composite" ? "translateZ(0)" : "";
        }

        // An unrelated animated span outside the table, running forever
        if (diag == "bodyanim") {
            if (self.diag_span === undefined) {
                self.diag_span = document.createElement("span");
                self.diag_span.id = "DiagAnim";
                self.diag_span.textContent = "\u25B2";
                document.body.appendChild(self.diag_span);
            }
            if (self.diag_anim === undefined) {
                self.diag_anim = self.diag_span.animate([
                    {"opacity": 0.2}, {"opacity": 1}, {"opacity": 0.2}
                ], {"duration": 2000, "iterations": Infinity});
            }
        } else if (self.diag_anim !== undefined) {
            self.diag_anim.cancel();
            self.diag_anim = undefined;
        }
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

        $row.children("td.f_name").text(user["f_name"]);
        $row.children("td.l_name").text(user["l_name"]);

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
    self.rank_handler = function (u_id, user) {
        user["rank_cell_text"] = self.format_rank(user);
        $(user["row"]).children("td.rank").children(".rank_label").text(user["rank_cell_text"]);
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
        var first_row = tbody.firstElementChild;

        // The row height must keep its fractional part (offsetHeight rounds
        // to an integer): index * height accumulates the rounding error to
        // whole rows' worth by the bottom of the table, e.g. when centering
        // on a followed row. Averaging over the whole body also irons out
        // per-row rounding of borders.
        var row_height = 0;
        if (first_row !== null) {
            row_height = tbody.getBoundingClientRect().height /
                         tbody.childElementCount;
        }

        var frame_rect = frame.getBoundingClientRect();
        // Where the badge gutter sits on screen, for the overlay badges: to
        // the left of the rank cell of whatever row is at the top
        var rank_cell = first_row !== null ?
                        first_row.querySelector("td.rank") : null;
        var rank_rect = rank_cell !== null ?
                        rank_cell.getBoundingClientRect() : {"left": 0};

        self.geometry = {
            "table_top": $("#Scoreboard")[0].offsetTop,
            "row_base": first_row !== null ? first_row.offsetTop : 0,
            "row_height": row_height,
            "frame": frame,
            "frame_height": frame.clientHeight,
            "frame_top": frame_rect.top,
            "frame_bottom": frame_rect.bottom,
            "gutter_right": rank_rect.left - 5
        };
    };

    // The offset of the user's row from the top of the table
    self.row_offset = function (user) {
        return self.geometry["row_base"] +
               user["index"] * self.geometry["row_height"];
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
        // With a filter active the indexes don't map to positions (hidden
        // rows still hold an index), so fall back to reading the layout
        var top = self.filtering ? user["row"].offsetTop : self.row_offset(user);
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

    // A "climbed/dropped n places" badge, shown in the gutter left of the
    // row while replaying. The badge_mode setting picks the implementation,
    // as their cost differs wildly on iOS WebKit:
    //
    //   "row"     - a permanent span per row inside its rank cell, faded
    //               with the Web Animations API
    //   "overlay" - spans in one fixed-position container outside the
    //               table, positioned from the cached row geometry
    //   "canvas"  - all badges drawn into a single canvas over the page
    //   "static"  - the "row" span, shown and hidden without animating
    //
    // The suspicion behind the non-"row" modes: an animated element inside
    // the table seems to put the table into an expensive compositing
    // configuration, which every row move then pays for, so the badges are
    // moved out of the table's subtree entirely.

    // Common bookkeeping: while a badge is showing, fold further movement
    // into it in place rather than restarting it (rapid rank changes would
    // otherwise flash constantly). Returns the delta to display, or 0 when
    // the row is back where its live badge started.
    self.delta_to_show = function (user, old_rank, new_rank, active) {
        var from = active ? user["delta_from"] : old_rank;
        if (!active) {
            user["delta_from"] = from;
        }
        return from - new_rank;
    };

    self.delta_text = function (delta) {
        return (delta > 0 ? "\u25B2" : "\u25BC") + Math.abs(delta);
    };

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
    // the row is scrolled out of the scoreboard frame. Positions come from
    // the cached row geometry, never from a layout read.
    self.place_overlay_badge = function (entry) {
        if (self.geometry === undefined) {
            self.measure_geometry();
        }
        var geometry = self.geometry;
        var top = geometry["frame_top"] +
                  self.row_offset(entry["user"]) + geometry["table_top"] -
                  geometry["frame"].scrollTop +
                  geometry["row_height"] / 2;
        var visible = top > geometry["frame_top"] &&
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

    self.show_overlay_delta = function (user, old_rank, new_rank) {
        var entry = user["delta_entry"];
        var active = entry !== undefined && entry["anim"].playState === "running";
        var delta = self.delta_to_show(user, old_rank, new_rank, active);

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
            ], {"duration": 2000, "easing": "ease-out"});
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
        entry["badge"].textContent = self.delta_text(delta);
        self.place_overlay_badge(entry);
    };

    ////// Canvas badges
    //
    // No per-badge elements at all: every live badge is drawn into one
    // canvas over the page from a single animation-frame loop, so the
    // browser has one composited object to deal with no matter how many
    // badges are alive.

    const CANVAS_DURATION = 2000;

    self.init_delta_canvas = function () {
        self.canvas_el = document.createElement("canvas");
        self.canvas_el.id = "RankDeltaCanvas";
        document.body.appendChild(self.canvas_el);
        self.canvas_ctx = self.canvas_el.getContext("2d");
        self.canvas_live = new Array();
        self.canvas_frame = undefined;
    };

    self.show_canvas_delta = function (user, old_rank, new_rank) {
        if (self.canvas_el === undefined) {
            self.init_delta_canvas();
        }

        var entry = user["delta_draw"];
        var active = entry !== undefined &&
                     self.canvas_live.indexOf(entry) !== -1;
        var delta = self.delta_to_show(user, old_rank, new_rank, active);

        if (delta == 0) {
            if (active) {
                self.canvas_live.splice(self.canvas_live.indexOf(entry), 1);
            }
            return;
        }

        if (!active) {
            entry = {"user": user, "start": performance.now()};
            user["delta_draw"] = entry;
            self.canvas_live.push(entry);
        }

        entry["text"] = self.delta_text(delta);
        entry["up"] = delta > 0;

        if (self.canvas_frame === undefined) {
            self.canvas_frame =
                window.requestAnimationFrame(self.draw_delta_canvas);
        }
    };

    self.draw_delta_canvas = function (now) {
        if (self.geometry === undefined) {
            self.measure_geometry();
        }
        var geometry = self.geometry;
        var canvas = self.canvas_el;
        var ratio = window.devicePixelRatio || 1;
        var width = geometry["gutter_right"] + 5;
        var height = geometry["frame_bottom"] - geometry["frame_top"];

        if (canvas.width !== Math.round(width * ratio) ||
            canvas.height !== Math.round(height * ratio)) {
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
            canvas.style.top = geometry["frame_top"] + "px";
        }

        var ctx = self.canvas_ctx;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        var scroll = geometry["frame"].scrollTop - geometry["table_top"];
        var remaining = new Array();

        for (const entry of self.canvas_live) {
            var age = (now - entry["start"]) / CANVAS_DURATION;
            if (age >= 1) {
                if (entry["user"]["delta_draw"] === entry) {
                    entry["user"]["delta_draw"] = undefined;
                }
                continue;
            }
            remaining.push(entry);

            var y = self.row_offset(entry["user"]) - scroll +
                    geometry["row_height"] / 2;
            if (y < 0 || y > height) {
                continue;
            }

            // Fade in over the first 15%, hold, then fade out
            var alpha = age < 0.15 ? age / 0.15 :
                        (age > 0.7 ? (1 - age) / 0.3 : 1);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = entry["up"] ? "#217A2B" : "#C03030";
            ctx.fillText(entry["text"], width - 5, y);
        }

        self.canvas_live = remaining;
        self.canvas_frame = remaining.length == 0 ? undefined :
            window.requestAnimationFrame(self.draw_delta_canvas);
    };

    self.show_rank_delta = function (user, old_rank, new_rank) {
        var mode = Settings.get_choice("badge_mode", "row");
        if (mode == "overlay") {
            self.show_overlay_delta(user, old_rank, new_rank);
            return;
        }
        if (mode == "canvas") {
            self.show_canvas_delta(user, old_rank, new_rank);
            return;
        }

        var badge = user["delta_badge"];
        if (badge === undefined || badge.parentNode === null ||
            badge.parentNode.parentNode !== user["row"]) {
            // Cached from the row, and refreshed whenever the row is rebuilt
            badge = $(user["row"]).children("td.rank").children(".rank_delta")[0];
            user["delta_badge"] = badge;
        }
        if (badge === undefined) {
            return;
        }

        var live = mode == "static" ? user["delta_timer"] !== undefined :
                   (user["delta_anim"] !== undefined &&
                    user["delta_anim"].playState === "running");
        var delta = self.delta_to_show(user, old_rank, new_rank, live);

        if (delta == 0) {
            if (live && mode == "static") {
                clearTimeout(user["delta_timer"]);
                self.hide_static_delta(user);
            } else if (live) {
                user["delta_anim"].cancel();
            }
            return;
        }

        if (!live && mode == "static") {
            badge.style.opacity = "1";
            user["delta_timer"] = window.setTimeout(function () {
                self.hide_static_delta(user);
            }, 2000);
        } else if (!live) {
            // The badge is opacity: 0 at rest, so it disappears when the
            // animation ends. WAAPI rather than CSS animations: the row is
            // re-inserted whenever it moves in the standings, which restarts
            // CSS animations (leaving the badge stuck alive), while WAAPI
            // animations survive DOM moves and reliably finish.
            user["delta_anim"] = badge.animate([
                {"opacity": 0, "transform": "translateY(2px)"},
                {"opacity": 1, "transform": "translateY(0)", "offset": 0.15},
                {"opacity": 1, "transform": "translateY(0)", "offset": 0.7},
                {"opacity": 0, "transform": "translateY(-3px)"}
            ], {"duration": 2000, "easing": "ease-out"});
        }

        badge.className = "rank_delta " + (delta > 0 ? "up" : "down");
        badge.textContent = self.delta_text(delta);
    };

    self.hide_static_delta = function (user) {
        user["delta_badge"].style.opacity = "";
        user["delta_timer"] = undefined;
    };

    // Record every row's vertical position; pass the result to animate_sort
    // after re-sorting to slide the rows from where they were
    self.measure_rows = function () {
        var result = new Object();
        for (const user of self.user_list) {
            result[user["key"]] = user["row"].offsetTop;
        }
        return result;
    };

    self.animate_sort = function (before) {
        var range = self.visible_range();
        var moved = new Array();

        for (const user of self.user_list) {
            var row = user["row"];
            var delta = before[user["key"]] - row.offsetTop;
            if (delta == 0) {
                continue;
            }

            // Only rows that are (or were) in the viewport get to slide
            var was_visible = before[user["key"]] + row.offsetHeight > range["top"] &&
                              before[user["key"]] < range["bottom"];
            if (!was_visible && !self.is_row_visible(user, range)) {
                continue;
            }

            moved.push([row, delta]);
        }

        // A stampede of sliding rows cannot be followed anyway
        if (moved.length == 0 || moved.length > 40) {
            return;
        }

        for (const [row, delta] of moved) {
            row.style.transition = "none";
            row.style.transform = "translateY(" + delta + "px)";
        }

        // Force a reflow so the starting offsets take hold before the slide
        void self.tbody_el[0].offsetWidth;

        for (const [row] of moved) {
            row.style.transition = "transform 0.25s ease-out";
            row.style.transform = "";
        }
    };
};
