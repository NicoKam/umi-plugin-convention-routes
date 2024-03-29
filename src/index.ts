import { join } from 'path';
import { scanRoutes } from 'routes-watcher';
import { IApi } from 'umi';
import { IRoute } from '@umijs/core';
import fs from 'fs';

type RouteConfig =
  | {
      children: RouteConfig[];
      [key: string]: any;
    }
  | IRoute;

function sortDynamicRoutes(arr: RouteConfig[] | undefined): IRoute[] {
  if (!arr) {
    return [];
  }
  return arr
    .map((r) => {
      if (Array.isArray(r.children) && r.children.length > 0) {
        return {
          ...r,
          children: sortDynamicRoutes(r.children),
        };
      }
      return r;
    })
    .sort((a, b) => {
      const dynA = a.path?.indexOf(':') ?? -1;
      const dynB = b.path?.indexOf(':') ?? -1;
      return dynA - dynB;
    });
}

export default (api: IApi) => {
  api.describe({
    key: 'conventionRoutesConfig',
    config: {
      schema(joi) {
        return joi.object({
          /** 页面根目录 */
          pageRoot: joi.string(),
          /** 路由过滤器 */
          filter: joi.function(),
          componentPath: joi.function(),
          extensions: joi.array().items(joi.string()),
          includes: joi.array().items(joi.object().instance(RegExp)),
          excludes: joi.array().items(joi.object().instance(RegExp)),
          /** 完成扫描路由后的提示 */
          successTips: joi.string(),
          /** 对生成的路由做一次整体调整 */
          modifyRoutes: joi.function(),
        });
      },
    },
  });

  let lastRoutesOutput = '';
  let lastRoutesConfig: IRoute[] = [];

  api.modifyRoutes(async (routes: IRoute[]) => {
    const { conventionRoutesConfig = {} } = api.config;
    const { successTips = 'Routes updated.', ...otherConventionRoutesConfig } = conventionRoutesConfig;

    const newRoutes = await new Promise<IRoute[]>((r) => {
      scanRoutes({
        pageRoot: api.paths.absPagesPath,
        childrenKey: 'routes',
        filter: (obj) => {
          return obj.name === 'index' || obj.name === '_layout';
        },
        excludes: [/[\\/](components|models|services|layouts)[\\/]/],
        modifyRoutePath: (path) => {
          return path.split('/').map((p) => {
            if(/\[([^/^\[^\]]+)\]/.test(p)){
              let name = p.slice(1, p.length - 1);
              if(p.endsWith('$]')){
                name = name.replace(/\$$/, '?');
              }
              return ':' + name;
            }
            return p;
          }).join('/');
        },
        ...otherConventionRoutesConfig,
        successTips: '',
        template: '@routerConfig',
        output: (outputStr: string) => {
          if (outputStr !== lastRoutesOutput) {
            lastRoutesOutput = outputStr;
            lastRoutesConfig = sortDynamicRoutes(JSON.parse(outputStr));
            api.logger.info(successTips);
          }
          r(lastRoutesConfig);
        },
        watch: false,
      });
    });
    if (routes[0] && routes[0].component && routes[0].component.startsWith('@/layouts/index.')) {
      const has404 =
        fs.existsSync(join(api.paths.absPagesPath!, '404.js')) ||
        fs.existsSync(join(api.paths.absPagesPath!, '404.tsx')) ||
        fs.existsSync(join(api.paths.absPagesPath!, '404.jsx'));
      const newRoute = [{ ...routes[0], routes: newRoutes }];
      if (has404) {
        type RouteConfig = typeof newRoute[0];
        function add404(routes: RouteConfig['routes']) {
          routes.forEach((route) => {
            if (route.exact !== true && route.routes != null) {
              add404(route.routes);
            }
          });
          routes.push({ component: '@/pages/404' });
        }

        add404(newRoute);
      }
      return newRoute;
    }
    return newRoutes;
  });
};
