# CodeGraph

知行项目使用 `@optave/codegraph` 建立后端 TypeScript 与 Vue/TypeScript
代码的本地调用关系图。生成的 SQLite 图数据库位于 `.codegraph/`，不会提交到 Git。

## 初始化与更新

```bash
npm install
npm run codegraph:build
npm run codegraph:stats
```

重大代码变更后重新运行 `npm run codegraph:build`。增量构建会复用没有变化的文件。

## 查询

```bash
npm run codegraph:where -- TutorEngine
npm run codegraph:context -- TutorEngine -T
npm run codegraph:impact -- respond -T
npm run codegraph:where -- executeProductLab
```

也可以直接使用本地 CLI：

```bash
npx codegraph where TutorEngine
npx codegraph context TutorEngine -T
npx codegraph fn-impact respond -T
```

CodeGraph 只读取当前工作区源码并在本地生成索引，不上传项目代码。
