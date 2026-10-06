import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://brunolauzon.github.io',
  base: '/lesvoyageursenfolie',
  output: 'static',
  trailingSlash: 'always',
});
