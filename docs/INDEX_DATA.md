# 指数历史数据维护

历史回测页使用 `public/data/` 中的月度静态 JSON。用户打开网站时不会调用第三方行情 API；更新数据后提交代码即可触发 Cloudflare Pages 重新部署。

## 当前口径

- 使用价格指数收盘点位，不包含分红再投资。
- 每个月只保留最后一个交易日的数据。
- 更新脚本不会发布尚未结束的当前月份。
- 回测假设每月最后一个交易日投入并允许碎股。
- 年管理费按等效月费率从相邻月份之间的资产中扣除。
- 不包含汇率、交易费用、税费和跟踪误差。

## 更新已有指数

环境要求：Node.js 20 或更高版本，不需要安装第三方依赖。

更新全部指数：

```bash
npm run data:update
npm run data:check
```

使用 `index:add` 添加的 CSV 指数会在“更新全部指数”时自动跳过；需要更新它时，重新下载 CSV，再使用 `--index ... --file ...` 导入。

只更新一个指数：

```bash
npm run data:update -- --index sp500
npm run data:update -- --index nasdaq100
npm run data:update -- --index csi300
npm run data:update -- --index csia500
```

脚本会更新对应的数据文件和 `public/data/indices.json` 中的 `firstDataDate`、`lastDataDate`。确认命令输出的起止日期合理后，再提交这些文件。

当前数据源：

- `sp500`：1957 年至 2015 年的长期种子来自 CRAN `qrmdata` 中的 S&P 500 日线数据；2016 年数据桥接后，用 FRED 最近十年的 `SP500` 日收盘数据覆盖和补充最近月份。
- `nasdaq100`：从 Nasdaq Historical API 拉取 `NDX` 日收盘数据。目前该接口实际提供约 30 年历史。
- `csi300`、`csi500`、`star50`：从东方财富公开行情接口拉取月线，使用未复权收盘点位。

内置指数和数据范围会由 `npm run data:check` 打印。网站只发布已结束月份，因此月中运行更新时不会写入尚未结束的当月数据。

免费公开接口可能发生限流、验证或格式变化。如果自动拉取失败，不要手工编辑 JSON，使用下面的 CSV 导入方式。

## 从本地 CSV 更新

准备包含日期和收盘点位的 CSV。支持的日期列名包括 `Date`、`date`、`日期`、`observation_date`；支持的收盘列名包括 `Close`、`Close/Last`、`Price`、`SP500`、`value`、`收盘`。

```csv
Date,Close
2026-05-29,12345.67
2026-06-30,12567.89
```

导入命令：

```bash
npm run data:update -- --index nasdaq100 --file ~/Downloads/ndx.csv
npm run data:check
```

CSV 可以是日线或月线；脚本会按月选择日期最晚的一条，并与已有历史合并。相同月份以新导入的数据为准。

## 新增一个指数：去哪里找什么数据

你需要找的是“指数历史行情”，不是指数成分股名单。下载文件至少要有两列：

```text
Date   交易日期
Close  当日收盘点位
```

本项目使用价格指数，因此下载时选择普通指数或 Price Index，不要选择 Total Return、Net Total Return，也不要选择 ETF 的 Adjusted Close。

可以优先从下面的网站寻找：

1. **Nasdaq Global Index Watch**：<https://indexes.nasdaq.com/>。适合 Nasdaq 编制的指数。搜索指数名称或代码，进入 History 页面，下载历史点位。例：纳斯达克100代码是 `NDX`。
2. **Stooq Historical Data**：<https://stooq.com/q/>。搜索指数名称或代码，进入 Historical data，选择 Daily，再下载 CSV。命令行入口可能出现浏览器验证，因此建议在浏览器中手动下载。
3. **指数编制公司官网**：例如 S&P DJI、FTSE Russell、MSCI、Nikkei。查找 Historical Data、Index History 或 Download Data。部分官方数据需要注册或只开放有限历史。

如果下载页面让你选择频率，选择 Daily（日线）或 Monthly（月线）都可以；更新脚本最终只保留每月最后一条。下载完成后打开 CSV，确认它确实有日期和收盘点位，而且最新一行日期合理。

注意检查数据网站的使用和再展示条款。免费获取不一定代表允许公开再分发。

## 用一条命令添加指数（推荐）

假设你从浏览器下载了日经225历史文件：

```text
~/Downloads/nikkei225.csv
```

运行：

```bash
npm run index:add -- \
  --id nikkei225 \
  --name "日经225" \
  --short-name "Nikkei 225" \
  --currency JPY \
  --inception 1950-09-07 \
  --symbol N225 \
  --source-label "Stooq" \
  --source-url "https://stooq.com/" \
  --file ~/Downloads/nikkei225.csv
```

参数含义：

- `--id`：项目内部名称，只能用小写字母、数字和连字符。
- `--name`：页面显示的中文名称。
- `--short-name`：英文或短名称。
- `--currency`：指数计价币种，例如 `USD`、`JPY`、`CNY`。
- `--inception`：指数或可用历史的开始日期。
- `--symbol`：数据网站使用的指数代码，可以不写。
- `--source-label`、`--source-url`：页面显示的数据来源。
- `--file`：刚下载的 CSV 路径。

这个命令会自动完成：

1. 把指数加入 `public/data/indices.json`。
2. 从 CSV 中提取每月最后一条收盘点位。
3. 生成 `public/data/nikkei225.json`。
4. 写入数据开始日期和截止日期。

如果 CSV 格式不正确，命令会报错并自动撤销注册，不会留下半成品。

添加后运行：

```bash
npm run data:check
python3 -m http.server 4173 --directory public
```

打开 `http://localhost:4173/backtest/`，新指数会自动出现在下拉框里。

## 手工注册指数（备用方式）

### 1. 注册指数

在 `public/data/indices.json` 的 `indices` 数组添加一项：

```json
{
  "id": "dowjones",
  "name": "道琼斯工业平均指数",
  "shortName": "Dow Jones",
  "description": "美国大型蓝筹公司价格指数",
  "currency": "USD",
  "dataFile": "/data/dowjones.json",
  "inceptionDate": "1896-05-26",
  "firstDataDate": null,
  "lastDataDate": null,
  "priceType": "price-index",
  "source": {
    "provider": "csv",
    "symbol": "DJIA",
    "label": "数据来源名称",
    "url": "https://数据来源页面"
  }
}
```

`id` 只能使用小写英文字母、数字和连字符；`dataFile` 推荐使用相同的 `id` 命名。

### 2. 导入首批数据

```bash
npm run data:update -- --index dowjones --file ~/Downloads/dowjones.csv
```

页面会读取注册表自动生成指数选项，不需要修改 HTML、回测引擎或页面 JavaScript。

### 3. 校验和预览

```bash
npm run data:check
python3 -m http.server 4173 --directory public
```

访问 `http://localhost:4173/backtest/`，确认：

1. 新指数出现在下拉列表。
2. 页面显示的数据截止日期正确。
3. 可选开始和结束月份与数据范围一致。
4. 选择近 5 年、近 10 年和全部数据均能正常计算。

### 4. 提交部署

需要提交的文件通常只有：

```text
public/data/indices.json
public/data/新指数.json
```

推送到 Cloudflare Pages 绑定的生产分支后，静态站会自动重新部署。

## 数据文件格式

生成文件结构如下：

```json
{
  "schemaVersion": 1,
  "indexId": "dowjones",
  "frequency": "monthly",
  "priceType": "close",
  "firstDataDate": "2000-01-31",
  "lastDataDate": "2026-06-30",
  "generatedAt": "2026-07-15T00:00:00.000Z",
  "importedFrom": null,
  "points": [
    ["2000-01-31", 10940.53]
  ]
}
```

不要直接修改元数据日期；更新脚本会根据 `points` 自动生成。
