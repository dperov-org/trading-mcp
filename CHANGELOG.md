# Changelog

## v2.1.4 (2026-05-07)

### 本次更新亮点

工具总数增至 **248 个**，新增 **WebSocket 下单** 与**持久订阅**两大基础能力，并全面扩充理财生态（Token 理财、定期理财、流动性挖矿、智能杠杆、双赢）及固定利率借贷体系，P2P 模块也补全了聊天与支付方式查询。

---

### 新增能力

#### WebSocket 交易下单（新分类：`wstrade`）
- 新增 6 个 WS 交易工具，通过 `/v5/trade` WebSocket 端点执行低延迟操作
  - `wsCreateOrder` — 单笔下单
  - `wsCancelOrder` — 单笔撤单
  - `wsAmendOrder` — 单笔改单
  - `wsBatchCreateOrders` — 批量下单（最多 20 笔）
  - `wsBatchCancelOrders` — 批量撤单（最多 20 笔）
  - `wsBatchAmendOrders` — 批量改单（最多 20 笔）

#### 持久 WebSocket 订阅（新分类：`subscription`）
- 新增 4 个订阅管理工具，支持后台持续积累推送消息、按需读取
  - `startSubscription` — 开启订阅，返回 `subscriptionId`
  - `readMessages` — 读取积累消息（支持分页、可选是否清空缓冲区）
  - `stopSubscription` — 关闭订阅，释放连接
  - `listSubscriptions` — 列出所有活跃订阅（调试用）
- 订阅 5 分钟未访问自动回收，最大缓冲 500 条消息（可配置，上限 5000）

#### Token 理财（新分类：`earntoken`）
- 支持 BYUSDT Token 产品的完整操作（7 个工具）
  - `placeTokenOrder` — 申购（Mint）/ 赎回（Redeem）
  - `getTokenPosition` — 查询持仓与收益概览
  - `getTokenOrderList` — 查询订单历史
  - `getTokenDailyYield` — 查询每日收益分配记录
  - `getTokenHourlyYield` — 查询小时收益记录
  - `getTokenHistoricalApr` — 查询历史 APR（公开，无需鉴权）
  - `getTokenProduct` — 查询产品详情（公开，无需鉴权）

#### 定期理财（新分类：`fixedterm`）
- 支持 FixedTermSaving / FundPool / FundPoolPremium 三类产品（6 个工具）
  - `placeFixedTermOrder` — 申购定期产品
  - `redeemFixedTerm` — 提前赎回
  - `setFixedTermAutoInvest` — 设置到期自动续期
  - `getFixedTermPosition` — 查询当前持仓
  - `getFixedTermOrder` — 查询申购赎回历史
  - `getFixedTermProduct` — 查询产品列表（公开，无需鉴权）

#### 流动性挖矿（新分类：`liquiditymining`）
- 支持从注入流动性到领取收益的完整生命周期（10 个工具）
  - `addLiquidity` — 注入流动性
  - `removeLiquidity` — 赎回流动性（支持部分赎回与单边赎回）
  - `reinvestLiquidity` — 将累积利息再投资
  - `addMargin` — 为杠杆仓位追加保证金
  - `claimLiquidityInterest` — 一键领取利息（支持 `-1` 全量领取）
  - `getLiquidityMiningPositions` — 查询当前持仓
  - `getLiquidityMiningOrders` — 查询订单历史 / 单笔订单详情
  - `getLiquidityMiningProducts` — 查询可用产品（公开，无需鉴权）
  - `getLiquidityMiningYieldRecords` — 查询收益记录
  - `getLiquidityMiningLiquidationRecords` — 查询清算记录

#### 智能杠杆（新分类：`smartleverage`）
- `getSmartLeverageRedeemEstAmountList` — 查询 SmartLeverage / DoubleWin 仓位赎回预估金额（下单前必须调用）

#### 双赢（新分类：`doublewin`）
- `getDoubleWinLeverage` — 查询 RFQ 类双赢产品的杠杆倍数与到期时间

#### 固定利率借贷（`spot-margin-trade-uta` 新增 6 个工具）
- `accountFixedBorrow` — 发起固定利率借款（支持 7 / 14 / 30 / 90 / 180 天）
- `renewFixedBorrow` — 续期已有借款合约
- `queryFixedBorrowOrders` — 查询借款订单历史
- `queryFixedBorrowContracts` — 查询已匹配合约明细
- `queryFixedBorrowMarket` — 查询固定利率市场挂单（供应方订单簿）
- `queryBorrowLiability` — 查询指定币种的借贷负债明细

#### P2P 交易补全（`p2p` 新增 3 个工具）
- `getChatMessages` — 查询指定订单的聊天记录
- `getCounterpartyUserInfo` — 查询交易对手方信息
- `getUserPayment` — 查询我的已配置付款方式

#### 基础理财增强（`earn` 新增 2 个工具）
- `getEarnAprHistory` — 查询 FlexibleSaving / OnChain 产品历史 APR（最大 182 天）
- `modifyEarnPosition` — 为 OnChain 固定期限仓位设置自动再投资

#### 高级理财增强（`advanceearn` 新增 1 个工具）
- `getAdvanceEarnProductExtraInfo` — 查询 DualAssets / SmartLeverage / DoubleWin 产品实时报价（来自机构做市商，秒级更新）

#### 账户管理增强（`account` 新增 1 个工具）
- `getAccountInfo` — 查询统一账户配置（保证金模式、账户状态、UTA 版本等）

#### 资产兑换增强（`asset/convert` 新增 2 个工具）
- `CoinConvertLimitQuery` — 查询指定币对在指定账户类型下的单次兑换最小/最大限额
- `QueryOrderFromOpenApi` — 通过 OpenAPI 分页查询兑换订单历史

#### 价差交易增强（`spread-trading` 新增 1 个工具）
- `getSpreadMaxQty` — 查询价差钱包可用余额（下单前确认可用头寸）

---

### 参数变更

- `postCryptoLoanFixedSupply` — 新增可选参数 `availableSource`（资金来源：0=FUND, 1=UNIFIED, 2=混合）
- `postCryptoLoanFixedSupplyOrderCancel` — 新增可选参数 `refundedAccount`（退款目标账户：0=FUND, 1=UNIFIED）

---

### 工具数量统计

| 分类 | 数量 | 备注 |
|------|------|------|
| `wstrade` | 6 | 新分类 |
| `subscription` | 4 | 新分类 |
| `earntoken` | 7 | 新分类 |
| `fixedterm` | 6 | 新分类 |
| `liquiditymining` | 10 | 新分类 |
| `smartleverage` | 1 | 新分类 |
| `doublewin` | 1 | 新分类 |
| 其他分类新增 | 14 | earn / advanceearn / p2p / account / asset / spot-margin / spread |
| **本次新增合计** | **49** | |
| **累计总数** | **248** | |

---

## v2.1.0 (2026-04-28)

### 本次更新亮点

工具数量突破 **200+**，覆盖从下单、仓位管理到理财、P2P、算法策略的完整交易场景。量化交易者、套利者还是资产管理用户，都能通过自然语言直接调用对应工具，无需手动拼接 API。

---

### 新增能力

#### 交易下单 & 仓位管理
- 支持**改单**（单笔 / 批量）、**批量下单**、**批量撤单**，一句话完成多腿操作
- 支持**下单前预检**，提前发现保证金不足、价格越界等问题，避免下单失败
- 仓位全生命周期管理：查看持仓、设止盈止损、调杠杆、切换仓位模式、转移仓位、查看历史盈亏

#### 算法策略交易
- 新增三类算法策略：**追单（Chase Order）**、**冰山（Iceberg）**、**TWAP**
- 支持创建、查询策略列表及关联订单、随时停止策略

#### RFQ 询价交易
- 支持完整 RFQ 流程：发起询价 → 报价 → 执行成交 → 查询历史
- 支持实时行情订阅（RFQ / Quotes Realtime）

#### 价差交易（Spread Trading）
- 支持价差合约的下单、改单、撤单
- 支持价差行情查询：Orderbook、Tickers、最新成交

#### 现货杠杆 & 借币
- 查询可借额度、当前状态、历史利率、VIP 利率档位
- 支持切换自动还款模式、调整现货保证金杠杆倍数

#### P2P 交易
- 支持发布 / 修改 / 下架广告，查询我的广告及市场广告
- 支持订单管理：查看待处理订单、标记付款、查询订单详情

#### 资产兑换（Convert）
- 支持查询可兑换币种列表、发起兑换、查询兑换历史

#### 账户管理
- 支持借币、还款、快速还款、查询借贷历史
- 支持设置 / 重置 MMP、切换组合保证金模式、切换对冲模式、调整抵押品开关

#### Alpha 区
- 支持 Biz Token 信息查询、获取报价、执行申购 / 赎回、查询订单

#### 高级理财（Advance Earn）
- 支持查询高级理财产品、持仓、订单，以及发起申购

#### 联盟（Affiliate）
- 支持查询推广用户信息及用户列表

#### 升级前历史数据
- 支持查询账户升级前的历史 PnL、交割记录、结算记录、成交记录、流水

#### WebSocket 订阅
- 新增系统状态（`subscribeSystemStatus`）订阅
- 修复成交、订单、持仓、钱包订阅的参数问题，推送更稳定
