import type { Config } from "tailwindcss";

const config = {
    darkMode: ["class"],
    content: [
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
    ],
    prefix: "",
    theme: {
        container: {
            center: true,
            padding: "2rem",
            screens: {
                "2xl": "1400px",
            },
        },
        extend: {
            fontFamily: {
                display: ['var(--font-playfair)', 'Georgia', 'serif'],
                sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
                mono: ['var(--font-mono)', 'monospace'],
            },
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                // Editorial Noir custom colors
                amber: {
                    DEFAULT: "#F4A261",
                    50: "#FEF7F0",
                    100: "#FDEBD8",
                    200: "#FAD4AD",
                    300: "#F7BD82",
                    400: "#F4A261",
                    500: "#EF8533",
                    600: "#D46A1A",
                    700: "#A65215",
                    800: "#783C10",
                    900: "#4A250A",
                },
                coral: {
                    DEFAULT: "#E76F51",
                    400: "#ED8F77",
                    500: "#E76F51",
                    600: "#D94F2E",
                },
                teal: {
                    DEFAULT: "#2DD4BF",
                    400: "#5EEAD4",
                    500: "#2DD4BF",
                    600: "#14B8A6",
                },
                surface: {
                    DEFAULT: "#14141A",
                    elevated: "#1C1C24",
                    hover: "#242430",
                },
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
                "fade-in-up": {
                    from: { opacity: "0", transform: "translateY(24px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                "slide-in-left": {
                    from: { opacity: "0", transform: "translateX(-20px)" },
                    to: { opacity: "1", transform: "translateX(0)" },
                },
                "slide-in-right": {
                    from: { opacity: "0", transform: "translateX(20px)" },
                    to: { opacity: "1", transform: "translateX(0)" },
                },
                "glow-pulse": {
                    "0%, 100%": { boxShadow: "0 0 20px -5px rgba(244, 162, 97, 0.3)" },
                    "50%": { boxShadow: "0 0 40px -5px rgba(244, 162, 97, 0.5)" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "fade-in-up": "fade-in-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards",
                "slide-in-left": "slide-in-left 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards",
                "slide-in-right": "slide-in-right 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards",
                "glow-pulse": "glow-pulse 3s ease-in-out infinite",
            },
            boxShadow: {
                'glow-amber': '0 0 40px -10px rgba(244, 162, 97, 0.4)',
                'glow-amber-sm': '0 0 20px -5px rgba(244, 162, 97, 0.3)',
                'glow-teal': '0 0 30px -10px rgba(45, 212, 191, 0.4)',
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
