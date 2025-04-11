const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

module.exports = {
  entry: {
    popup: "./src/popup.js",
    content: "./src/content.js",
    background: "./src/background.js"
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js"
  },
  mode: "production",
  plugins: [
    new CleanWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        { from: "./src/manifest.json" },
        { from: "./src/popup.html" },
        { from: "./src/styles.css" },
        { from: "./src/*.{png,svg}", to: "[name][ext]"}
      ]
    })
  ]
};
