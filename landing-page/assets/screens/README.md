# Screenshot Slots

这个目录里的图片目前都是占位图，方便页面先上线。

## 当前截图位

- `hero-main-light.svg` / `hero-main-dark.svg`
  建议替换为：产品第一眼主界面，优先放侧栏整体效果图

- `workflow-summary-light.svg` / `workflow-summary-dark.svg`
  建议替换为：摘要生成过程、模式切换、二次生成按钮区域

- `history-reader-light.svg` / `history-reader-dark.svg`
  建议替换为：历史/收藏面板，或独立阅读页双栏布局

- `settings-panel-light.svg` / `settings-panel-dark.svg`
  建议替换为：设置页里的连接配置、厂商预设、入口检查等界面

## 最推荐的方式

1. 每个截图位准备一张浅色截图和一张深色截图。
2. 保持现有 `-light` 和 `-dark` 文件名不变。
3. 直接覆盖当前占位图。

这样页面切换主题时，截图也会自然跟着切，不需要对同一张图做滤镜处理。

## 如果暂时只有一套截图

也可以先把浅色和深色都做成同一张图，比如：

- `hero-main-light.webp`
- `hero-main-dark.webp`

内容先一样，后面再慢慢拆成两套。

## 如果你想换成别的格式

1. 把文件放进这个目录，比如 `hero-main-light.webp`
2. 修改 `../../index.html` 里对应的 `data-light-src` / `data-dark-src`

## 截图建议

- 尽量统一圆角和外边距
- 优先导出 2x 清晰度
- 单张宽度建议在 `1400px - 2200px`
- 如果截图信息很多，优先裁掉浏览器无关区域，突出产品本体
- 深色主题最好配深色截图，浅色主题最好配浅色截图，整体会更协调