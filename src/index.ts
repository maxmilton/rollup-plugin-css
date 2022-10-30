import { createFilter, FilterPattern } from '@rollup/pluginutils';
import type { TransformOptions } from 'lightningcss';
import * as lightningcss from 'lightningcss';
import type { Targets } from 'lightningcss/node/targets';
import path from 'path';
import type { Plugin, SourceMap } from 'rollup';
import { SourceMapConsumer, SourceNode } from 'source-map';

export interface PluginOptions {
  /**
   * Files to exclude from processing.
   *
   * @default []
   */
  exclude?: FilterPattern | undefined;
  /**
   * Files to include in processing.
   *
   * @default /\.x?css$/
   */
  include?: FilterPattern | undefined;
  /** Minify CSS with `csso`. */
  minify?: boolean | undefined;
  targets?: Targets | undefined;
  /**
   * Name of combined CSS file to emit.
   *
   * When not defined the asset name will be inferred from `rollup#output.name`
   * or `rollup#output.file`.
   */
  name?: string | undefined;
}

export default function rollupPlugin({
  exclude = [],
  name,
  include = /\.x?css$/,
  minify,
  targets,
}: PluginOptions = {}): Plugin {
  const filter = createFilter(include, exclude);
  const styles = new Map<string, string>();
  const sourcemaps = new Map<string, SourceMap>();
  let useSourceMaps: boolean | 'inline' | 'hidden';

  return {
    name: 'maxmilton-css',

    renderStart(outputOptions) {
      useSourceMaps = outputOptions.sourcemap;
    },

    transform(code, id) {
      if (!filter(id)) return null;

      styles.set(id, code);

      if (useSourceMaps) {
        sourcemaps.set(id, this.getCombinedSourcemap());
      }

      return {
        code: '',
        map: { mappings: '' },
      };
    },

    async generateBundle(outputOpts) {
      if (styles.size === 0) return;

      let css = '';

      for (const id of styles.keys()) {
        css += styles.get(id) || '';
      }

      if (!css) return;

      const inferredName = name
        || outputOpts.name
        || (outputOpts.file && path.basename(outputOpts.file));

      if (!inferredName) {
        this.error(
          'Unable to infer output CSS asset name; add "name" to plugin options or rollup output options',
        );
      }

      const assetName = inferredName.replace(path.extname(inferredName), '');
      const combinedCss = `${css}`;
      let minifiedMap;

      if (minify) {
        const minified = lightningcss.transform({
          filename: assetName,
          code: Buffer.from(css),
          minify: true,
          sourceMap: !!outputOpts.sourcemap,
          targets,
        } as TransformOptions);

        for (const warning of minified.warnings) {
          this.warn(warning.message);
        }

        css = minified.code.toString();
        minifiedMap = minified.map?.toString();
      }

      const assetFileId = this.emitFile({
        name: `${assetName}.css`,
        source: css,
        type: 'asset',
      });

      if (outputOpts.sourcemap) {
        const mapNodes = [];

        for (const id of sourcemaps.keys()) {
          mapNodes.push(
            SourceNode.fromStringWithSourceMap(
              styles.get(id)!,
              // eslint-disable-next-line no-await-in-loop
              await new SourceMapConsumer(sourcemaps.get(id)!),
            ),
          );
        }

        if (minifiedMap) {
          mapNodes.push(
            SourceNode.fromStringWithSourceMap(
              combinedCss,
              await new SourceMapConsumer(minifiedMap),
            ),
          );
        }

        const root = new SourceNode(null, null, null, mapNodes);
        const out = root.toStringWithSourceMap({
          file: `${assetName}.css`,
        });

        if (outputOpts.sourcemap === 'inline') {
          css += `\n/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
            out.map.toString(),
            'utf8',
          ).toString('base64')} */`;
        } else {
          const assetFileName = this.getFileName(assetFileId);

          this.emitFile({
            fileName: `${assetFileName}.map`,
            source: out.map.toString(),
            type: 'asset',
          });

          if (outputOpts.sourcemap !== 'hidden') {
            css += `\n/*# sourceMappingURL=${assetFileName}.map */`;

            // FIXME: Can't getFileName before setting CSS source; Overwriting
            // like this causes a warning: The emitted file "app-c3ca2dbc.css"
            // overwrites a previously emitted file of the same name.
            this.emitFile({
              fileName: assetFileName,
              source: css,
              type: 'asset',
            });
            //  ↳ Can't getFileName before setAssetSource :(
            // this.setAssetSource(assetFileId, css);
          }
        }
      }
    },
  };
}
