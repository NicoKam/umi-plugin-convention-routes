import { join } from 'path';
import scanRoutes from 'routes-watcher';
import { IApi } from 'umi';
import { IRoute } from '@umijs/core';

type RouteConfig = {
  children: RouteConfig[];
  [key: string]: any;
} | IRoute;

function flatten<T>(arr: T[]) {
  const res: T[] = [];
  arr.forEach((T) => {
    if (Array.isArray(T)) {
      res.push(...T);
    } else {
      res.push(T);
    }
  });
  return res;
}

function sortDynamicRoutes(arr: RouteConfig[] | undefined): IRoute[] {
  if (!arr) {
    return [];
  }
  return arr.sort((a, b) => {
    const dynA = a.path?.indexOf(':') ?? -1;
    const dynB = b.path?.indexOf(':') ?? -1;
    return dynA - dynB;
  });
}

function changeChildrenName(arr: RouteConfig[] | undefined): IRoute[] {
  if (!arr) {
    return [];
  }
  return flatten(
    arr.map(({ children, component, ...route }) => {
      if (component)
        return {
          ...route,
          component,
          routes: changeChildrenName(children),
        };
      return changeChildrenName(children);
    }),
  );
}

const replaceDynamicRoutePath = (path: string) => {
  return path.replace(/\[([^/^\[^\]]+)\]/g, (match0, match1, index, str) => {
    if (
      index > 0 &&
      str[index - 1] === '/' &&
      (index + match0.length >= str.length || str[index + match0.length] === '/')
    ) {
      return `:${match1}`;
    }
    return match0;
  });
};

export default (api: IApi) => {
  api.describe({
    key: 'conventionRoutesConfig',
    config: {
      schema(joi) {
        return joi.object();
      },
    },
  });
  api.modifyRoutes(async (routes: IRoute[]) => {
    const { conventionRoutesConfig } = api.config;

    const newRoutes = await new Promise<IRoute[]>((r) => {
      scanRoutes({
        pageRoot: api.paths.absPagesPath,
        files: ['index.js', 'index.ts', '_layout.js', '_layout.ts', '_layout.jsx', '_layout.tsx'],
        ignore: ['**/components/**', '**/layouts/**', '**/models/**', '**/services/**'],
        formatter: ({ files = {}, fullPath, path, children = [] }, { toScript, pushChild, relativePageRoot }) => {
          const res: any = {
            path: replaceDynamicRoutePath(fullPath || path),
          };

          if (files['index']) {
            const component = join('@/pages', files['index']).replace(/\\/g, '/');
            if (files['_layout'] || children.length > 0) {
              pushChild({ ...res, component, exact: true });
            } else {
              res.component = component;
              res.exact = true;
            }
          }
          if (files['_layout']) {
            res.component = join('@/pages', files['_layout']).replace(/\\/g, '/');
            res.exact = false;
          }

          Object.keys(files)
            .filter((p) => p !== 'index' && p !== '_layout')
            .forEach((subFile) => {
              pushChild({
                path: `${res.path}/${subFile}`,
                component: join('@/pages', files[subFile]).replace(/\\/g, '/'),
                exact: true,
              });
            });

          return res;
        },
        ...conventionRoutesConfig,
        template: '@routerConfig',
        output: (outputStr) => {
          r(sortDynamicRoutes(changeChildrenName(JSON.parse(outputStr))));
        },
        watch: false,
      });
    });
    if (routes[0].component === '@/layouts/index.js') {
      /* 有layout的情况 */
      return [{ ...routes[0], routes: newRoutes }];
    }
    return newRoutes;
  });
};
