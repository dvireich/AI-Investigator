import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const noCoverageIgnoreRule = {
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/v8 ignore|istanbul ignore|c8 ignore/.test(comment.value)) {
            context.report({
              node: comment,
              message: 'Coverage-ignore comments are banned. Make the code testable instead.',
            })
          }
        }
      },
    }
  },
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: { local: { rules: { 'no-coverage-ignore': noCoverageIgnoreRule } } },
    rules: {
      'local/no-coverage-ignore': 'error',
    },
  },
])
