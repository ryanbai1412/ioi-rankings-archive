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

import DataStore from "./DataStore.js";

// gold medal boundary at x means rank <= x gets gold
export const MEDAL_BOUNDARIES = {
    2026: {
        gold: 32,
        silver: 94,
        bronze: 188,
    },
    2025: {
        gold: 28,
        silver: 83,
        bronze: 165,
    },
    2024: {
        gold: 34,
        silver: 96,
        bronze: 189,
    },
    2023: {
        gold: 30,
        silver: 89,
        bronze: 178,
    },
    2022: {
        gold: 30,
        silver: 89,
        bronze: 179,
    },
    2021: {
        gold: 30,
        silver: 86,
        bronze: 173,
    },
    2020: {
        gold: 29,
        silver: 87,
        bronze: 174,
    },
    2019: {
        gold: 28,
        silver: 82,
        bronze: 163,
    },
    2017: {
        gold: 26,
        silver: 80,
        bronze: 156,
    }
};

export default new function () {
    var self = this;

    self.get_contest_list_url = function () {
        return "contests/";
    };

    self.get_task_list_url = function () {
        return "tasks/";
    };

    self.get_team_list_url = function () {
        return "teams/";
    };

    self.get_user_list_url = function () {
        return "users/";
    };

    self.get_flag_url = function (t_key) {
        // 2nd teams
        t_key = t_key.slice(0, 3);
        // the ioi2017 iran team 2 is IRI for some reason
        if (t_key === "IRI") {
            t_key = "IRN";
        }

        return "../flags-c76d8b51cddaf48f/" + t_key + ".png";
    };

    self.get_face_url = function (u_key) {
        var ext = (DataStore.asset_config && DataStore.asset_config["face_ext"]) || "png";

        return "faces/" + u_key + "." + ext;
    };

    self.get_submissions_url = function (u_key) {
        return "sublist/" + u_key;
    };

    self.get_score_url = function () {
        return "scores";
    };

    self.get_history_url = function () {
        return "history";
    }

    self.get_asset_config_url = function() {
        return "asset_config";
    };

    self.get_stats_url = function () {
        return "../stats.json";
    };

    self.get_medal = function (rank) {
        const {gold, silver, bronze} = MEDAL_BOUNDARIES[DataStore.year];

        if (rank <= gold) {
            return "gold";
        } else if (rank <= silver) {
            return "silver";
        } else if (rank <= bronze) {
            return "bronze";
        } else {
            return "none";
        }
    }
};
