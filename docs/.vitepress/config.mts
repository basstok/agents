import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Basstok Agents",
  description: "Build external Agents with the Basstok REST API.",
  lang: "en-US",
  base: process.env.DOCS_BASE ?? "/",
  cleanUrls: true,
  markdown: {
    theme: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Official Agents", link: "/official-agents" },
      { text: "REST API", link: "https://github.com/basstok/api" },
      { text: "FAQ", link: "/faq" },
      { text: "Basstok", link: "https://basstok.com/" },
    ],
    sidebar: [
      {
        text: "Basstok Agents",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Getting started", link: "/getting-started" },
          { text: "Writing an Agent", link: "/writing-an-agent" },
          { text: "Connection setup", link: "/connecting" },
          { text: "Official Agents", link: "/official-agents" },
          { text: "REST API", link: "https://github.com/basstok/api" },
          { text: "FAQ", link: "/faq" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/basstok/agents" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Basstok Inc",
    },
    search: { provider: "local" },
  },
});
