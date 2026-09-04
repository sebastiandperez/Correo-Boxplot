import { defineConfig } from 'eslint/config'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default defineConfig([
  {
    ignores: [
      'analysis/**',
      'analisis/**',
      'repos/**',
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
    ],
  },
  ...pluginVue.configs['flat/recommended'],
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.vue'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      ...tseslint.configs.recommended[1].rules,
      ...tseslint.configs.recommended[2].rules,
      // Prettier owns Vue template layout. These stylistic rules disagree with
      // its stable output and therefore only create non-actionable warnings.
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
])
