# ETF 历史溢价数据维护

ETF 溢价页面使用预先生成的静态 JSON，浏览器访问页面时不会请求第三方行情。数据由维护者手动更新并在提交前校验。

## 计算口径

当前使用“相对上一期净值溢价率”：

```text
溢价率 =（场内收盘价 / 交易日前最近一期单位净值 - 1）× 100%
```

只允许匹配严格早于交易日的净值。净值日期与交易日期相差超过 7 个自然日时，该交易日不生成数据点。

这个指标不是盘中 IOPV。QDII 基金还会受到中美交易时差、汇率和净值披露延迟影响，不能将结果直接视为买卖信号。

## 更新与检查

更新全部指数和 ETF：

```bash
npm run data:update
```

只更新 ETF：

```bash
npm run data:update:etf
```

只更新一只 ETF：

```bash
npm run data:update:etf -- --etf 159501
```

检查全部数据：

```bash
npm run data:check
```

更新器会重试远程请求、在行情主源不可用时使用备用源，并将新旧数据按交易日期合并。所有待更新 ETF 都成功构建后才写入正式文件；失败不会清空已有历史数据。

## 数据来源

- ETF 日线主源：东方财富历史 K 线公开接口
- ETF 日线备用与校验：新浪历史 K 线公开接口
- 基金净值主源：天天基金页面使用的静态历史净值数据
- 基金净值备用：天天基金分页历史净值接口

以上均为免费公开网页数据，不承诺接口长期不变。页面和数据文件会记录实际成功使用的来源；交易前应以基金管理人和交易所披露为准。

## CSV 离线兜底

远程来源不可用时，可以导入包含以下表头的 UTF-8 CSV：

```csv
code,date,close,nav_date,nav
159501,2026-07-17,1.984,2026-07-16,1.8462
```

执行：

```bash
npm run data:update:etf -- --etf-file /absolute/path/to/etf.csv
```

CSV 必须包含注册表中本次更新的全部 ETF。若只导入一只，可以同时添加 `--etf 159501`。

## 新增同类 ETF

ETF 和指数分组由 `public/data/etf-premium/registry.json` 驱动。以后新增标普 500 或纳斯达克 100 ETF 时，只需在 `etfs` 数组增加配置：

```json
{
  "id": "nasdaq100-example",
  "groupId": "nasdaq100",
  "code": "159000",
  "market": "SZ",
  "name": "纳指ETF示例",
  "manager": "示例基金",
  "color": "#7c3aed",
  "dataFile": "/data/etf-premium/159000.json"
}
```

随后执行：

```bash
npm run data:update:etf -- --etf 159000
npm run data:check
```

页面会自动读取新增配置并将新 ETF 加入所属分组的图表、最新卡片和历史分布表，无需修改页面脚本。

配置要求：

- `id`、`code` 和 `dataFile` 必须唯一
- `groupId` 必须对应 `groups` 中已有分组
- `market` 只能为 `SH` 或 `SZ`
- 同组曲线颜色应尽量区分

如果未来新增标普 500、纳斯达克 100 之外的指数类别，先在 `groups` 中增加分组，再按相同方式添加 ETF 即可。
