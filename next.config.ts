import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本地单用户应用：页面每次都要读最新的 SQLite 数据，
  // 开启 cacheComponents 会与 force-dynamic 冲突，故关闭。
  cacheComponents: false,
  // pdfjs 依赖 worker 文件与动态 import，打包后会丢失这些资源，
  // 交给 Node 运行时直接加载即可。
  serverExternalPackages: ["pdfjs-dist"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
