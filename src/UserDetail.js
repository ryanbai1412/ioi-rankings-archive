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
import DataStore, {round, round_to_str} from "./DataStore.js";
import { format_time } from "./TimeView.js";
import HistoryStore from "./HistoryStore.js";
import Config, { MEDAL_BOUNDARIES } from "./Config.js";
import Chart from "./Chart.js";

// format_time is defined in TimeView

export default new function () {
    var self = this;

    self.init = function () {
        $("#UserDetail_bg").click(function (event) {
            if (event.target == event.currentTarget) {
                self.hide();
            }
        });

        $("#UserDetail_close").click(function () {
            self.hide();
        });

        $(document).keyup(function (event) {
            if (event.keyCode == 27) { // ESC key
                self.hide();
            }
        });

        self.name_label = $('#UserDetail_name > a');
        // self.l_name_label = $('#UserDetail_l_name');
        self.team_label = $('#UserDetail_team');
        self.flag_image = $('#UserDetail_flag');
        self.face_image = $('#UserDetail_face');
        self.title_label = $('#UserDetail_title');

        self.navigator = $('#UserDetail_navigator table tbody');
        self.submission_table = $('#UserDetail_submissions');

        self.score_chart = $('#UserDetail_score_chart')[0];
        self.rank_chart = $('#UserDetail_rank_chart')[0];

        self.charts_container = $('#UserDetail_charts')[0];
        self.chart_hover_line = $('#UserDetail_chart_hover_line')[0];
        self.chart_dot_score = $('#UserDetail_chart_dot_score')[0];
        self.chart_dot_rank = $('#UserDetail_chart_dot_rank')[0];
        self.chart_tooltip = $('#UserDetail_chart_tooltip')[0];
        self.chart_tooltip_time = $('#UserDetail_chart_tooltip_time')[0];
        self.chart_tooltip_score = $('#UserDetail_chart_tooltip_score')[0];
        self.chart_tooltip_tasks = $('#UserDetail_chart_tooltip_tasks')[0];
        self.chart_tooltip_tasks_row = $('#UserDetail_chart_tooltip_tasks_row')[0];
        self.chart_tooltip_rank = $('#UserDetail_chart_tooltip_rank')[0];
        self.chart_data = null;

        $(self.charts_container).on("mousemove", self.on_chart_hover);
        $(self.charts_container).on("mouseleave", self.hide_chart_hover);

        self.navigator.on("click", "td.btn", function () {
            if (self.active !== null) {
                self.active.removeClass("active");
            }
            self.active = $(this).parent();
            self.active.addClass("active");

            if (self.active.hasClass('global')) {
                self.show_global();
            } else if (self.active.hasClass('contest')) {
                self.show_contest(self.active.attr('data-contest'));
            } else if (self.active.hasClass('task')) {
                self.show_task(self.active.attr('data-task'));
            }
        });

        window.addEventListener("hashchange", self.toggle_visibility_from_hash);
        self.toggle_visibility_from_hash();
    };

    self.get_current_hash = function () {
        return window.location.hash.substr(1);
    };

    self.toggle_visibility_from_hash = function () {
        var user_id = self.get_current_hash();
        if (user_id == "") {
            // No user requested, hide the details if they were open.
            self.hide();
        } else if (!DataStore.users.hasOwnProperty(user_id)) {
            // Non-existing user, do as if the request was without the hash.
            window.history.replaceState(
                {}, "", window.location.href.replace(/#.*$/, ''));
            self.hide();
        } else {
            // Some valid user requested, show the details.
            self.show(user_id);
        }
    };

    // MODIFICATION: title to be IOI yyyy - person
    self.show = function (user_id) {
        self.user_id = user_id;
        self.user = DataStore.users[user_id];
        self.data_fetched = 0;

        if (self.get_current_hash() != user_id) {
            window.history.pushState({}, "", "#" + user_id);
        }
        window.document.title = `IOI ${DataStore.year} - ${self.user["f_name"]} ${self.user["l_name"]}`;

        HistoryStore.request_update(self.history_callback);

        if (DataStore.asset_config && DataStore.asset_config["nosublist"]) {
            self.data_fetched = 3
            self.do_show();
        } else {
            self.submissions_callback(window.data.sublist[self.user_id]);
            // $.ajax({
            //     url: Config.get_submissions_url(self.user_id),
            //     dataType: "json",
            //     success: self.submissions_callback,
            //     error: function () {
            //         console.error("Error while getting the submissions for " + self.user_id);
            //         self.data_fetched = 3;
            //         self.do_show();
            //     }
            // });
        }
    };

    self.history_callback = function () {
        self.task_s = new Object();
        self.task_r = new Object();
        for (var t_id in DataStore.tasks) {
            self.task_s[t_id] = HistoryStore.get_score_history_for_task(self.user_id, t_id);
            self.task_r[t_id] = HistoryStore.get_rank_history_for_task(self.user_id, t_id);
        }

        self.contest_s = new Object();
        self.contest_r = new Object();
        for (var c_id in DataStore.contests) {
            self.contest_s[c_id] = HistoryStore.get_score_history_for_contest(self.user_id, c_id);
            self.contest_r[c_id] = HistoryStore.get_rank_history_for_contest(self.user_id, c_id);
        }

        self.global_s = HistoryStore.get_score_history(self.user_id);
        self.global_r = HistoryStore.get_rank_history(self.user_id);

        self.data_fetched += 1;
        self.do_show();
    }

    self.submissions_callback = function (data) {
        self.submissions = new Object();
        for (var t_id in DataStore.tasks) {
            self.submissions[t_id] = new Array();
        }
        for (var i = 0; i < data.length; i += 1) {
            var submission = data[i];
            self.submissions[submission['task']].push(submission);
        }

        self.data_fetched += 1;
        self.do_show();
    };

    self.do_show = function () {
        if (self.data_fetched >= 2) {
            let href;
            const name = self.user["f_name"] + " " + self.user["l_name"];

            if (DataStore.stats_people) {
                href = DataStore.search_stats_person(self.user_id);
                if (!href) {
                    console.warn("Couldn't find stats link for", self.user);
                }
            }
            if (!href) {
                href = new URL(`https://stats.ioinformatics.org/search?yf=${DataStore.year}&ys=${DataStore.year}`);
                href.searchParams.set("q", name);
                href = href.toString();
            }

            self.name_label.attr("href", href).html(self.user["f_name"] + "<br>" + self.user["l_name"]);
            // self.f_name_label.text(self.user["f_name"]);
            // self.l_name_label.text(self.user["l_name"]);
            if (DataStore.asset_config && DataStore.asset_config["nofaces"])
                self.face_image.addClass("hidden")
            else {
                self.face_image.removeClass("hidden");
                // MODIFICATION - we first clear the src so we don't show the old face while the browser loads the new image
                self.face_image.attr("src", "");
                self.face_image.attr("src", Config.get_face_url(self.user_id));
            }

            if (self.user["team"]) {
                self.team_label.text(DataStore.teams[self.user["team"]]["name"]);
                if (DataStore.asset_config && DataStore.asset_config["noflags"])
                    self.flag_image.addClass("hidden");
                else{
                    self.flag_image.attr("src", Config.get_flag_url(self.user['team']));
                    self.flag_image.removeClass("hidden");
                }
            } else {
                self.team_label.text("");
                self.flag_image.addClass("hidden");
            }

            var s = "<tr class=\"global\"> \
                        <td class=\"name\">Global</td> \
                        <td class=\"score\">" + (self.global_s.length > 0 ? round_to_str(self.global_s[self.global_s.length-1][1], DataStore.global_score_precision) : 0) + "</td> \
                        <td class=\"rank\">" + (self.global_r.length > 0 ? self.global_r[self.global_r.length-1][1] : 1) + "</td> \
                        <td class=\"btn\"><a>Show</a></td> \
                    </tr>";

            var contests = DataStore.contest_list;
            for (var i in contests) {
                var contest = contests[i];
                var c_id = contest["key"];

                s += "<tr class=\"contest\" data-contest=\"" + c_id +"\"> \
                         <td class=\"name\">" + contest['name'] + "</td> \
                         <td class=\"score\">" + (self.contest_s[c_id].length > 0 ? round_to_str(self.contest_s[c_id][self.contest_s[c_id].length-1][1], contest["score_precision"]) : 0) + "</td> \
                         <td class=\"rank\">" + (self.contest_r[c_id].length > 0 ? self.contest_r[c_id][self.contest_r[c_id].length-1][1] : 1) + "</td> \
                         <td class=\"btn\"><a>Show</a></td> \
                      </tr>"

                var tasks = contest["tasks"];
                for (var j in tasks) {
                    var task = tasks[j];
                    var t_id = task["key"];

                    s += "<tr class=\"task\" data-task=\"" + t_id +"\"> \
                             <td class=\"name\">" + task['name'] + "</td> \
                             <td class=\"score\">" + (self.task_s[t_id].length > 0 ? round_to_str(self.task_s[t_id][self.task_s[t_id].length-1][1], task["score_precision"]) : 0) + "</td> \
                             <td class=\"rank\">" + (self.task_r[t_id].length > 0 ? self.task_r[t_id][self.task_r[t_id].length-1][1] : 1) + "</td>"
                    
                    if (!(DataStore.asset_config && DataStore.asset_config["nosublist"])) s += "<td class=\"btn\"><a>Show</a></td>"
                    
                    s += "</tr>"
                }
            }

            self.navigator.html(s);

            self.active = null;

            $('tr.global td.btn', self.navigator).click();

            $("#UserDetail_bg").addClass("open");
        }
    };

    self.show_global = function () {
        self.title_label.text("Global");

        var task_ids = new Array();
        for (var i = 0; i < DataStore.contest_list.length; i += 1) {
            var tasks = DataStore.contest_list[i]["tasks"];
            for (var j = 0; j < tasks.length; j += 1) {
                task_ids.push(tasks[j]["key"]);
            }
        }
        self.submission_table.html(self.make_merged_submission_table(task_ids, true));

        var intervals = new Array();
        var b = 0;
        var e = 0;

        for (var i = 0; i < DataStore.contest_list.length; i += 1) {
            b = DataStore.contest_list[i]["begin"];
            e = DataStore.contest_list[i]["end"];
            while (i+1 < DataStore.contest_list.length && DataStore.contest_list[i+1]["begin"] <= e) {
                i += 1;
                e = (e > DataStore.contest_list[i]["end"] ? e : DataStore.contest_list[i]["end"]);
            }
            intervals.push([b, e]);
        }

        self.draw_charts(intervals, DataStore.global_max_score,
                         self.global_s, self.global_r,
                         DataStore.global_score_precision,
                         task_ids);
    };

    self.show_contest = function (contest_id) {
        var contest = DataStore.contests[contest_id];

        self.title_label.text(contest["name"]);

        var task_ids = contest["tasks"].map(function (task) {
            return task["key"];
        });
        self.submission_table.html(self.make_merged_submission_table(task_ids, false));

        self.draw_charts([[contest["begin"], contest["end"]]], contest["max_score"],
                         self.contest_s[contest_id], self.contest_r[contest_id],
                         contest["score_precision"],
                         task_ids);
    };

    self.show_task = function (task_id) {
        var task = DataStore.tasks[task_id];
        var contest = DataStore.contests[task["contest"]];

        self.title_label.text(task["name"]);
        self.submission_table.html(self.make_submission_table(task_id));

        self.draw_charts([[contest["begin"], contest["end"]]], task["max_score"],
                         self.task_s[task_id], self.task_r[task_id],
                         task["score_precision"],
                         null);
    };

    self.draw_charts = function (ranges, max_score, history_s, history_r, score_precision, breakdown_tasks) {
        var users = DataStore.user_count;

        self.chart_data = {
            "ranges": ranges,
            "history_s": history_s,
            "history_r": history_r,
            "score_precision": score_precision,
            "max_score": max_score,
            "breakdown_tasks": breakdown_tasks,
        };
        self.hide_chart_hover();

        Chart.draw_chart(self.score_chart, // canvas object
            0, max_score, 0, 0, // y_min, y_max, x_default, h_default
            ranges, // intervals
            history_s, // data
            [102, 102, 238], // color
            [max_score*1/4, // markers
             max_score*2/4,
             max_score*3/4]);

        const {gold, silver, bronze} = MEDAL_BOUNDARIES[DataStore.year];
        Chart.draw_chart(self.rank_chart, // canvas object
            users, 1, 1, users-1, // y_min, y_max, x_default, h_default
            ranges, // intervals
            history_r, // data
            [210, 50, 50], // color
            [gold, // markers
             silver,
             bronze]);
    };

    self.hide_chart_hover = function () {
        self.chart_hover_line.style.display = "none";
        self.chart_tooltip.style.display = "none";
        self.chart_dot_score.style.display = "none";
        self.chart_dot_rank.style.display = "none";
    };

    self.on_chart_hover = function (event) {
        if (self.chart_data === null) {
            return;
        }

        var ranges = self.chart_data["ranges"];
        var x_size = 0;
        for (var i = 0; i < ranges.length; i += 1) {
            x_size += ranges[i][1] - ranges[i][0];
        }
        if (x_size <= 0) {
            return;
        }

        var pad = Chart.padding;
        var cont_rect = self.charts_container.getBoundingClientRect();
        var score_rect = self.score_chart.getBoundingClientRect();
        var rank_rect = self.rank_chart.getBoundingClientRect();

        // Both charts share the same geometry, so use the score chart to map
        // the mouse position back to a chart x value (in canvas pixels)
        var x_scale = self.score_chart.width / score_rect.width;
        var canvas_x = (event.clientX - score_rect.left) * x_scale;
        if (canvas_x < pad.l || canvas_x > self.score_chart.width - pad.r) {
            self.hide_chart_hover();
            return;
        }

        // Chart x value -> absolute time, undoing the gap-stripping between
        // the drawn intervals (see Chart.draw_chart)
        var x_val = (canvas_x - pad.l) * x_size / (self.score_chart.width - pad.l - pad.r);
        var time = ranges[ranges.length-1][1];
        var x_cum = 0;
        for (var i = 0; i < ranges.length; i += 1) {
            var size = ranges[i][1] - ranges[i][0];
            if (x_val <= x_cum + size) {
                time = ranges[i][0] + (x_val - x_cum);
                break;
            }
            x_cum += size;
        }

        // Look up the values in effect at that time (histories are sorted)
        var score = 0;
        var history_s = self.chart_data["history_s"];
        for (var i = 0; i < history_s.length && history_s[i][0] <= time; i += 1) {
            score = history_s[i][1];
        }
        // Before any event everyone is tied at rank 1 (matching the chart's
        // default values)
        var rank = 1;
        var rank_ties = DataStore.user_count - 1;
        var history_r = self.chart_data["history_r"];
        for (var i = 0; i < history_r.length && history_r[i][0] <= time; i += 1) {
            rank = history_r[i][1];
            rank_ties = history_r[i][2];
        }

        // Label the time as elapsed time within the contest it falls in,
        // naming the contest when more than one is displayed
        var time_str = null;
        for (var i = 0; i < DataStore.contest_list.length; i += 1) {
            var contest = DataStore.contest_list[i];
            if (contest["begin"] <= time && time <= contest["end"]) {
                time_str = format_time(Math.floor(time - contest["begin"]));
                if (ranges.length > 1 || DataStore.contest_list.length > 1) {
                    time_str = contest["name"] + " \u2014 " + time_str;
                }
                break;
            }
        }
        if (time_str === null) {
            time_str = format_time(Math.floor(time - ranges[0][0]));
        }

        // Per-problem score breakdown (e.g. "100/15/79"), one group per
        // contest day, skipping days that haven't started at that time
        var breakdown = "";
        var breakdown_tasks = self.chart_data["breakdown_tasks"];
        if (breakdown_tasks !== null && breakdown_tasks.length > 1) {
            var last_contest = null;
            for (var i = 0; i < breakdown_tasks.length; i += 1) {
                var t_id = breakdown_tasks[i];
                var task = DataStore.tasks[t_id];
                if (DataStore.contests[task["contest"]]["begin"] > time) {
                    continue;
                }
                var t_score = 0;
                var t_history = self.task_s[t_id];
                for (var j = 0; j < t_history.length && t_history[j][0] <= time; j += 1) {
                    t_score = t_history[j][1];
                }
                if (breakdown != "") {
                    breakdown += task["contest"] == last_contest ? "/" : " \u00b7 ";
                }
                breakdown += Math.round(t_score);
                last_contest = task["contest"];
            }
        }

        self.chart_tooltip_time.textContent = time_str;
        self.chart_tooltip_score.textContent = round_to_str(score, self.chart_data["score_precision"]);
        self.chart_tooltip_tasks.textContent = breakdown;
        self.chart_tooltip_tasks_row.style.display = breakdown != "" ? "block" : "none";
        self.chart_tooltip_rank.textContent =
            rank_ties > 0 ? rank + "\u2013" + (rank + rank_ties) : rank;

        // The vertical line spans the plot areas of both charts
        var line_top = (score_rect.top - cont_rect.top) + pad.t * (score_rect.height / self.score_chart.height);
        var line_bottom = (rank_rect.bottom - cont_rect.top) - pad.b * (rank_rect.height / self.rank_chart.height);
        var line_x = event.clientX - cont_rect.left;
        self.chart_hover_line.style.display = "block";
        self.chart_hover_line.style.left = line_x + "px";
        self.chart_hover_line.style.top = line_top + "px";
        self.chart_hover_line.style.height = (line_bottom - line_top) + "px";

        // Mark the value on each chart's line, mapping the value to canvas
        // coordinates the same way Chart.draw_chart does
        var place_dot = function (dot, canvas, rect, y_min, y_max, value) {
            var span = y_max - y_min == 0 ? 1 : y_max - y_min;
            var canvas_y = pad.t + (y_max - value) * (canvas.height - pad.t - pad.b) / span;
            dot.style.display = "block";
            dot.style.left = line_x + "px";
            dot.style.top = (rect.top - cont_rect.top + canvas_y * (rect.height / canvas.height)) + "px";
        };
        var max_score = self.chart_data["max_score"];
        place_dot(self.chart_dot_score, self.score_chart, score_rect,
                  0, max_score, score);
        place_dot(self.chart_dot_rank, self.rank_chart, rank_rect,
                  DataStore.user_count, 1, rank);

        // Place the tooltip beside the cursor, flipping to the left side
        // when it would overflow the charts area
        self.chart_tooltip.style.display = "block";
        var tip_w = self.chart_tooltip.offsetWidth;
        var tip_h = self.chart_tooltip.offsetHeight;
        var tip_x = line_x + 14;
        if (tip_x + tip_w > cont_rect.width - 4) {
            tip_x = line_x - tip_w - 14;
        }
        var tip_y = (event.clientY - cont_rect.top) - tip_h / 2;
        tip_y = Math.max(0, Math.min(tip_y, cont_rect.height - tip_h));
        self.chart_tooltip.style.left = tip_x + "px";
        self.chart_tooltip.style.top = tip_y + "px";
    };

    // Sorted list of every contestant's final score on a task, taken from the
    // raw data (the live user objects get rewritten while the timeline is
    // scrubbed, so they can't be trusted to hold the final scores)
    self.final_scores_cache = new Object();

    self.get_final_task_score = function (u_id, task_id) {
        var user_scores = window.data.scores[u_id];
        var s = user_scores && user_scores[task_id] !== undefined ? user_scores[task_id] : 0.0;
        return round(s, DataStore.tasks[task_id]["score_precision"]);
    };

    self.get_final_scores = function (task_id) {
        if (!self.final_scores_cache[task_id]) {
            var scores = new Array();
            for (var u_id in DataStore.users) {
                scores.push(self.get_final_task_score(u_id, task_id));
            }
            scores.sort(function (a, b) { return a - b; });
            self.final_scores_cache[task_id] = scores;
        }
        return self.final_scores_cache[task_id];
    };


    // Global 1-based index of each task (day order, then task order within
    // the day), e.g. 1-6 at a regular IOI
    self.get_task_index = function (task_id) {
        if (!self.task_index_cache) {
            self.task_index_cache = new Object();
            var index = 1;
            for (var i = 0; i < DataStore.contest_list.length; i += 1) {
                var tasks = DataStore.contest_list[i]["tasks"];
                for (var j = 0; j < tasks.length; j += 1) {
                    self.task_index_cache[tasks[j]["key"]] = index;
                    index += 1;
                }
            }
        }
        return self.task_index_cache[task_id];
    };

    // Per-subtask maximums, parsed from the trailing "(N)" of each subtask
    // header (e.g. "Subtask 1 (5)"); for the rare header without one, fall
    // back to the best value any contestant ever got on that subtask
    self.subtask_max_cache = new Object();

    self.get_subtask_maxes = function (task_id) {
        if (!self.subtask_max_cache[task_id]) {
            var headers = DataStore.tasks[task_id]["extra_headers"];
            var n = headers.length;
            var maxes = new Array(n);
            var missing = false;
            for (var j = 0; j < n; j += 1) {
                var m = /\((\d+(?:\.\d+)?)\)\s*$/.exec(headers[j]);
                maxes[j] = m ? parseFloat(m[1]) : null;
                missing = missing || maxes[j] === null;
            }
            if (missing) {
                var derived = new Array(n).fill(0);
                for (var u_id in window.data.sublist) {
                    var subs = window.data.sublist[u_id];
                    for (var i = 0; i < subs.length; i += 1) {
                        if (subs[i]["task"] != task_id) {
                            continue;
                        }
                        for (var j = 0; j < n; j += 1) {
                            var v = parseFloat(subs[i]["extra"][j]);
                            if (v > derived[j]) {
                                derived[j] = v;
                            }
                        }
                    }
                }
                for (var j = 0; j < n; j += 1) {
                    if (maxes[j] === null) {
                        maxes[j] = derived[j];
                    }
                }
            }
            self.subtask_max_cache[task_id] = maxes;
        }
        return self.subtask_max_cache[task_id];
    };

    // Same bucketing as the scoreboard cells (see Scoreboard.get_score_class)
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

    self.get_percentile_class = function (percentile) {
        if (percentile === null) {
            return "";
        }
        var bucket = Math.min(Math.floor(percentile / 10) * 10, 90);
        return "pct_" + bucket + "_" + (bucket + 10);
    };

    // Percentile rank of the given score amongst the given final scores
    // (ties count for half, i.e. the mean-rank definition)
    self.percentile_within = function (scores, score) {
        if (scores.length == 0) {
            return null;
        }
        var less = 0;
        var equal = 0;
        for (var i = 0; i < scores.length; i += 1) {
            if (scores[i] < score) {
                less += 1;
            } else if (scores[i] == score) {
                equal += 1;
            }
        }
        return (less + equal / 2) / scores.length * 100;
    };

    self.get_percentile = function (task_id, score) {
        return self.percentile_within(self.get_final_scores(task_id), score);
    };

    self.format_percentile = function (percentile) {
        return percentile === null ? "-" : round_to_str(percentile, 1) + "%";
    };


    // A single table with the submissions on all the given tasks, in
    // chronological order, optionally with a column naming the contest day
    self.make_merged_submission_table = function (task_ids, show_day) {
        if (!self.submissions) {
            return "";
        }

        var submissions = new Array();
        for (var i = 0; i < task_ids.length; i += 1) {
            var t_id = task_ids[i];
            for (var j = 0; j < self.submissions[t_id].length; j += 1) {
                submissions.push(self.submissions[t_id][j]);
            }
        }
        submissions.sort(function (a, b) { return a["time"] - b["time"]; });

        var n_cols = show_day ? 6 : 5;

        var res = " \
<table> \
    <thead> \
        <tr> \
            " + (show_day ? "<td>Day</td>" : "") + " \
            <td>Time</td> \
            <td>Problem</td> \
            <td>Score</td> \
            <td>Cumulative Score</td> \
            <td>Percentile</td> \
        </tr> \
    </thead> \
    <tbody>";

        if (submissions.length == 0) {
            res += " \
        <tr> \
            <td colspan=\"" + n_cols + "\">no submissions</td> \
        </tr>";
        } else {
            for (var i = 0; i < submissions.length; i += 1) {
                var submission = submissions[i];
                var task = DataStore.tasks[submission["task"]];
                var contest = DataStore.contests[task["contest"]];
                var score_precision = task["score_precision"];
                var time = format_time(submission["time"] - contest["begin"]);
                var percentile = self.get_percentile(task["key"], submission.cumulative_score);
                res += " \
        <tr> \
            " + (show_day ? "<td>" + contest["name"] + "</td>" : "") + " \
            <td>" + time + "</td> \
            <td class=\"task_color_" + ((self.get_task_index(task["key"]) - 1) % 8 + 1) + "\">" + task["name"] + " (" + self.get_task_index(task["key"]) + ")</td> \
            <td class=\"" + self.get_score_class(submission["score"], task["max_score"]) + "\">" + round_to_str(submission["score"], score_precision) + "</td> \
            <td class=\"" + self.get_score_class(submission.cumulative_score, task["max_score"]) + "\">" + round_to_str(submission.cumulative_score, score_precision) + "</td> \
            <td class=\"" + self.get_percentile_class(percentile) + "\">" + self.format_percentile(percentile) + "</td> \
        </tr>";
            }
        }
        res += " \
    </tbody> \
</table>";
        return res;
    };

    self.make_submission_table = function (task_id) {
        const extra_headers = DataStore.tasks[task_id]['extra_headers'];
        const score_precision = DataStore.tasks[task_id]['score_precision'];

        // With many subtask columns (IOI 2026's Magic City has 51) the fixed
        // table layout would squeeze every column into an unreadable sliver.
        // When the columns would drop below a readable width, switch the
        // table to a horizontally scrolling layout instead: every subtask
        // column gets a comfortable width and the CSS pins the three meta
        // columns to the left (their 80+80+120 widths there must add up to
        // the 280 used here). Tables that fit keep the plain layout.
        var table_attrs = "";
        var display_headers = extra_headers;
        var container_width = self.submission_table.width();
        var n_cols = 3 + extra_headers.length;
        if (container_width > 0 && container_width / n_cols < 40) {
            var min_width = 280 + extra_headers.length * 30;
            table_attrs = " class=\"subtask_scroll\" style=\"min-width: " + min_width + "px\"";
            // The narrow columns can't fit the full "Subtask N (pts)"
            // labels, so abbreviate them to "#N (pts)"
            display_headers = extra_headers.map(function (header) {
                return header.replace(/^Subtask /, "#");
            });
        }

        var res = " \
<table" + table_attrs + "> \
    <thead> \
        <tr> \
            <td>Time</td> \
            <td>Score</td> \
            <td>Cumulative Score</td>\
            " + (display_headers.length > 0 ? "<td>" + display_headers.join("</td><td>") + "</td>" : "") + " \
        </tr> \
    </thead> \
    <tbody>";

        if (self.submissions[task_id].length == 0) {
            res += " \
        <tr> \
            <td colspan=\"" + (3 + DataStore.tasks[task_id]['extra_headers'].length) + "\">no submissions</td> \
        </tr>";
        } else {
            const max_score = DataStore.tasks[task_id]["max_score"];
            const subtask_maxes = self.get_subtask_maxes(task_id);
            for (const submission of Object.values(self.submissions[task_id])) {
                var time = submission["time"] - DataStore.contests[DataStore.tasks[task_id]["contest"]]["begin"];
                time = format_time(time);
                res += " \
        <tr> \
            <td>" + time + "</td> \
            <td class=\"" + self.get_score_class(submission['score'], max_score) + "\">" + round_to_str(submission['score'], score_precision) + "</td> \
            <td class=\"" + self.get_score_class(submission.cumulative_score, max_score) + "\">" + round_to_str(submission.cumulative_score, score_precision) + "</td>\
            " + submission["extra"].map((s, i) => {
                const v = parseFloat(s);
                // A 0-point subtask (e.g. samples) can only ever be "complete"
                const cls = subtask_maxes[i] <= 0 ? "score_100" : self.get_score_class(v, subtask_maxes[i]);
                return `<td class="${cls}">${round_to_str(v, score_precision)}</td>`;
            }).join("") + " \
        </tr>";
            }
        }
        res += " \
    </tbody> \
</table>";
        return res;
    };

    self.hide = function () {
        if (self.get_current_hash() != "") {
            window.history.pushState(
                {}, "", window.location.href.replace(/#.*$/, ''));
        }
        window.document.title = `IOI ${DataStore.year} Rankings`;
        $("#UserDetail_bg").removeClass("open");
    };
};
