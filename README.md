# 定投收益计算器

一个零运行时依赖的静态定投工具，包含固定收益估算、指数历史定投回测和多指数对比，可直接部署到 Cloudflare Workers 静态资源托管。

**在线体验：** [https://dca-calculator.mrhanlu224.workers.dev/](https://dca-calculator.mrhanlu224.workers.dev/)

## 功能

- 首次投入的底仓从投资开始时参与复利
- 每月定投资金默认按月初投入
- 年化收益率转换为等效月化收益率并按月复利
- 年管理费率转换为等效月费率并按月扣除
- 展示总本金、期末金额、累计收益、总收益率和累计管理费
- 展示逐年本金、资产、收益和累计管理费明细
- 响应式布局，适配桌面和手机
- 使用价格指数月末收盘数据回测历史定投
- 内置 5 个常用指数，覆盖美国宽基、科技和中国大中盘、科创板
- 支持在共同月份中对比多个指数的标准化累计表现、历史回撤和年化波动
- 通过注册表扩展新指数，不需要修改回测页面或计算引擎
- 页面展示数据来源和数据截止日期

## 本地预览

直接打开 `public/index.html`，或在项目目录运行：

```bash
python3 -m http.server 4173 --directory public
```

然后访问 `http://localhost:4173`。

历史回测页位于 `http://localhost:4173/backtest/`。

指数对比页位于 `http://localhost:4173/compare/`。

## 历史数据更新

项目使用静态月度数据，网站运行时不请求第三方行情接口。需要更新时手动执行：

```bash
npm run data:update
npm run data:check
```

更新后提交 `public/data/` 下发生变化的文件即可。去哪里下载 CSV、下载哪些列、CSV 导入以及一条命令新增指数的完整步骤见 [指数历史数据维护文档](docs/INDEX_DATA.md)。

当前内置：标普500、纳斯达克100、沪深300、中证500和科创50。

运行计算和数据测试：

```bash
npm test
```

## 部署到 Cloudflare Pages

将仓库推送到 GitHub 后，在 Cloudflare 的 Workers & Pages 中选择 Pages，并导入该 GitHub 仓库。

构建设置：

| 配置项 | 值 |
| --- | --- |
| Production branch | `main` |
| Build command | `exit 0` |
| Build output directory | `public` |

Cloudflare Pages 会在每次推送到 `main` 后自动部署，并为 Pull Request 创建预览环境。历史数据也是普通静态文件，不需要配置 D1、R2 或 Pages Functions。

## 计算口径

月化收益率采用以下方式从年化收益率换算：

```text
月化收益率 = (1 + 年化收益率)^(1/12) - 1
```

等效月管理费率采用：

```text
月管理费率 = 1 - (1 - 年管理费率)^(1/12)
```

底仓在第 0 个月投入；每月定投在月初发生。每月先计算投资收益，再从当期资产中扣除管理费；累计管理费为投资期内每月实际扣费之和。若使用的收益率已经扣除管理费，应将管理费率设为 0，避免重复扣费。计算结果是固定收益率假设下的估算，不代表实际投资回报。
