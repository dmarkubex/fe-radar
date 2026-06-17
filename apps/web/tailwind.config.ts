import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#ffffff",
          warm: "#eaf5fb",
          deep: "#005b86",
        },
        bg: {
          DEFAULT: "#f5f9fc",
          deep: "#e8f3f8",
        },
        fg: {
          DEFAULT: "#143141",
          muted: "#4d6674",
          soft: "#7690a0",
          "on-dark": "#ffffff",
        },
        accent: {
          DEFAULT: "#00618f",
          flame: "#008fc4",
          block: "#008fc4",
        },
        sunshine: {
          900: "#00618f",
          700: "#0098c8",
          500: "#0098c8",
          300: "#9dd8e8",
        },
        gold: "#cfeaf4",
        yellow: "#e8f3f8",
        border: {
          DEFAULT: "#d5e6ee",
          strong: "#a9c9d8",
        },
        hairline: "#e4edf2",
        danger: "#c0331a",
        warn: "#d97706",
        ok: "#2f7d4f",
      },
      fontFamily: {
        display: [
          "Arial",
          "Helvetica Neue",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        body: [
          "Arial",
          "Helvetica Neue",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "IBM Plex Mono",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        card: "none",
        pop: "0 12px 32px rgba(0, 97, 143, 0.12)",
      },
      letterSpacing: {
        tightest: "-2.4px",
      },
      borderRadius: {
        none: "0px",
      },
    },
  },
};

export default config;
