// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // <--- THIS IS CRUCIAL FOR YOUR THEME SWITCHER
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // This tells Tailwind to scan your React components
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}