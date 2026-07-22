const path = require('node:path');

const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (_environment, arguments_) => {
    const production = arguments_.mode === 'production';

    return {
        context: __dirname,
        mode: production ? 'production' : 'development',
        devtool: false,
        entry: {
            contentscript: './source/contentscript/index.ts',
            popup: './source/popup/index.tsx',
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx'],
            alias: {
                '~common': path.resolve(__dirname, 'source/common'),
                '~contentscript': path.resolve(__dirname, 'source/contentscript'),
                '~data': path.resolve(__dirname, 'source/data'),
                '~popup': path.resolve(__dirname, 'source/popup'),
                'styled-components': path.resolve(__dirname, 'node_modules/styled-components'),
            },
        },
        output: {
            clean: true,
            filename: '[name].js',
            path: path.join(__dirname, 'distribution'),
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            compilerOptions: {
                                noEmit: false,
                            },
                        },
                    },
                    exclude: /node_modules/,
                },
            ],
        },
        optimization: {
            minimize: production,
            minimizer: [
                new TerserPlugin({
                    extractComments: false,
                }),
            ],
        },
        performance: {
            hints: production ? 'error' : false,
            maxAssetSize: 450_000,
            maxEntrypointSize: 450_000,
        },
        plugins: [
            new CopyPlugin({
                patterns: [
                    {
                        from: './source/manifest.json',
                        to: './manifest.json',
                    },
                    {
                        from: './source/assets',
                        to: 'assets',
                        globOptions: {
                            ignore: ['**/.DS_Store', '**/.gitkeep'],
                        },
                    },
                    {
                        from: './LICENSE',
                        to: 'LICENSE',
                        toType: 'file',
                    },
                ],
            }),
            new HtmlWebpackPlugin({
                template: './source/popup/index.html',
                chunks: ['popup'],
                filename: 'popup.html',
                minify: production,
            }),
        ],
        stats: 'errors-warnings',
    };
};
