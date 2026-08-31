# 强证据小尺寸 Flat-Fill 入口设计

## 背景

强证据 40px adaptive 候选已经能正确定位并进入现有 known-48 edge-cleanup。`severe-10` 经过三次 edge-cleanup 后，空间残留为 `0.128`、梯度残留为 `0.277`、halo 为 `0.83`、瑕疵成本为 `0.309`，仍显示轻微星形边缘。

诊断确认 flat-fill 没有失败，也没有被候选质量门拒绝。它在生成候选之前就被 `KNOWN_48_FLAT_FILL_MIN_GRADIENT = 0.28` 拦截；当前梯度 `0.277` 仅低约 `0.003`。一次临时单变量实验把入口调到 `0.27` 后，flat-fill 被采用，梯度降至 `0.223`、halo 降至 `0.15`、瑕疵成本降至 `0.255`，空间残留保持 `0.127`。实验代码已还原。

## 目标

- 仅为已标记的强证据 38–42px adaptive 路径使用 `0.27` flat-fill 入口。
- 普通 known-48、catalog、standard 和 preview-anchor 路径继续使用 `0.28`。
- 复用现有 flat-fill 生成及全部空间、梯度、背景平坦度、halo 和损伤验收门。
- 不改变定位、alpha 模板、增益、清理顺序或瑕疵反馈契约。

## 方案比较

### 方案 A：路径专属入口阈值（采用）

清理资格层已经知道候选是否带有 `strongUndersizedMatch` provenance。该事实随 cleanup flags 传入修复阶段，flat-fill 调用时选择 `0.27` 或默认 `0.28`。

优点是范围精确，普通样本行为保持不变。缺点是需要传递一个额外布尔标记或解析后的阈值。

### 方案 B：全局阈值改为 0.27

实现最短，但会让所有 40–56px known-48 路径扩大 flat-fill 入口，不采用。

### 方案 C：flat-fill 先于 edge-cleanup

会改变全部清理顺序和候选基线，影响更大，不采用。

## 设计

### 清理资格

复用现有强小尺寸条件：

- `selectedTrial.provenance.adaptive === true`；
- `selectedTrial.provenance.strongUndersizedMatch === true`；
- 最终宽度在 `38..42px`；
- source 以 `adaptive` 开头；
- 非 preview-anchor。

清理 flags 除 `useKnown48EdgeCleanup` 外，再明确暴露该路径是否为 strong undersized adaptive。不得在 flat-fill 层重新使用边距或 source 字符串猜测资格。

### 阈值传递

修复阶段配置保留默认 `known48FlatFillMinGradient = 0.28`，并新增强小尺寸值 `strongUndersizedFlatFillMinGradient = 0.27`。创建 flat-fill stage 时，根据 cleanup flag 选择入口阈值；第二次 pass 的最小改善阈值仍保持现有值，不变更候选验收逻辑。

### 数据流

trial provenance → `createRepairCleanupFlags` 产生强小尺寸清理标记 → accepted executor 把标记传给 repair stage specs → flat-fill stage 选择 `0.27` 入口 → 现有 `refineKnown48FlatBackgroundResidual` 生成候选 → 现有质量门决定是否采用。

## 测试与验收

1. cleanup flags 测试确认只有带完整 provenance、38–42px、adaptive source 的候选得到专属标记。
2. repair stage specs 测试确认专属路径传入 `0.27`，普通 known-48 路径仍传入 `0.28`。
3. `severe-10` 保持 40px 定位，source 包含 `flat-fill`，梯度低于 `0.277`、halo 低于 `0.83`、瑕疵成本低于 `0.309`。
4. 36 样本保持 `clean=19`、干净恢复 `15/16`、灾难性块 `0`。
5. 419 样本保持 `304 applied-clean / 115 residual-risk`、retry `0`、错误 `0`、灾难性块 `0`。

## 非目标

- 不全局降低 flat-fill 阈值。
- 不新增填充、模糊或 inpaint 算法。
- 不改变 flat-fill preset 强度。
- 不把 82px 边距加入 catalog。
