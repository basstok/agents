import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import AgentsHome from "./AgentsHome.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("AgentsHome", AgentsHome);
  },
} satisfies Theme;
