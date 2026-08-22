import { resolve } from "path";
import { defineConfig } from "vite";

const config = {
    "2017": {
        favicon: "img/favicon.ico",
        logo: "img/logo.svg",
    },
    "2019": {
        favicon: "img/favicon.png",
        logo: "img/logo.png",
    },
    "2020": {
        favicon: "img/favicon.ico",
        logo: "img/logo.png",
    },
    "2021": {
        favicon: "img/favicon.ico",
        logo: "img/logo.png",
    },
    "2022": {
        favicon: "img/favicon.png",
        logo: "img/logo.png",
    },
    "2023": {
        favicon: "img/favicon.png",
        logo: "img/logo.png",
    },
    "2024": {
        favicon: "img/favicon.png",
        logo: "img/logo.png"
    },
    "2025": {
        favicon: "img/logo.png",
        "logo": "img/logo.png",
    },
    "2026": {
        favicon: "img/logo.png",
        logo: "img/logo.png",
    },
};

const years = [2017, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

function patchHtmlPlugin() {
    function transformIndexHtml(src, path) {
        const year = path.match(/\/ioi-(\d{4})\/index.html$/)?.[1];

        if (year == undefined) {
            return;
        }

        function replace(key, value) {
            src = src.replaceAll(`%${key.toUpperCase()}%`, value);
        }

        replace("year", year);
        for (const [key, value] of Object.entries(config[year])) {
            replace(key, value);
        }

        return src;
    }

    return {
        name: "patch-ioi-html",

        transformIndexHtml(src, ctx) {
            src = transformIndexHtml(src, ctx.path) ?? src;

            // The year's data chunk is only dynamically imported (so it
            // doesn't block hydration), which means Vite doesn't emit a
            // modulepreload for it; inject one so the browser starts the
            // download at parse time
            const year = ctx.path.match(/\/ioi-(\d{4})\/index.html$/)?.[1];
            if (year !== undefined && ctx.bundle !== undefined) {
                for (const chunk of Object.values(ctx.bundle)) {
                    if (chunk.type === "chunk" &&
                        chunk.facadeModuleId?.endsWith(`ioi-${year}/data.json`)) {
                        return {
                            html: src,
                            tags: [{
                                tag: "link",
                                attrs: {
                                    rel: "modulepreload",
                                    crossorigin: true,
                                    href: `/${chunk.fileName}`,
                                    // The data is by far the largest download
                                    // and everything waits on it, so on slow
                                    // connections it must win the bandwidth
                                    // over images and the other chunks
                                    fetchpriority: "high",
                                },
                                injectTo: "head",
                            }],
                        };
                    }
                }
            }

            return src;
        },

        transform: transformIndexHtml,
    }
}

export default defineConfig({
    appType: "mpa",
    plugins: [patchHtmlPlugin()],
    root: resolve(__dirname, "src"),
    resolve: {
        preserveSymlinks: true
    },
    build: {
        emptyOutDir: true,
        outDir: resolve(__dirname, "dist"),
        sourcemap: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, "src/index.html"),
                "404": resolve(__dirname, "src/404.html"),
                ...Object.fromEntries(years.map(y => [`ioi-${y}`, resolve(__dirname, `src/ioi-${y}/index.html`)])),
            },
            output: {
                manualChunks: {
                    jquery: ["jquery"],
                    raphael: ["raphael"],
                    stats: [resolve(__dirname, "src/stats.json")]
                }
            }
        },
    },
});
