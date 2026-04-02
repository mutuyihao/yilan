# Landing Page

这个目录是给 `一览 / Yilan` 准备的独立静态产品落地页，适合直接部署到 Vercel。

## 文件结构

```text
landing-page/
├─ index.html
├─ styles.css
├─ theme.js
├─ vercel.json
└─ assets/
   └─ screens/
      ├─ README.md
      ├─ hero-main-light.svg / hero-main-dark.svg
      ├─ workflow-summary-light.svg / workflow-summary-dark.svg
      ├─ history-reader-light.svg / history-reader-dark.svg
      └─ settings-panel-light.svg / settings-panel-dark.svg
```

## 直接部署到 Vercel

1. 在 Vercel 中导入这个仓库。
2. 把 Root Directory 设置为 `landing-page`。
3. Framework Preset 选 `Other`。
4. Build Command 留空。
5. Output Directory 留空。
6. 点击 Deploy。

这个目录没有构建步骤，Vercel 会直接把静态文件托管出去。

## 主题能力

页面支持三种模式：

- `系统`：跟随 `prefers-color-scheme`
- `日间`：固定浅色
- `深夜`：固定深色

用户的手动选择会记录在 `localStorage`，下次打开会继续沿用。

## 截图怎么替换

去看 [assets/screens/README.md](./assets/screens/README.md)。

现在页面里放的是成对的浅色 / 深色 SVG 占位图，所以即使你还没准备真实截图，页面也能正常展示。

后面你有两种替换方式：

1. 保持现有 `-light / -dark` 文件名不变，直接覆盖占位图。
2. 换成你自己的文件名，然后同步修改 `index.html` 里的 `data-light-src` 和 `data-dark-src`。

## 页面内容改哪里

- 主文案：`index.html`
- 配色和布局：`styles.css`
- 主题逻辑：`theme.js`
- 截图素材：`assets/screens/`

## 建议替换的内容

- Hero 第一屏：换成最完整的一张产品主界面截图
- Workflow：换成生成过程或模式切换截图
- Shots 区域：换成历史/收藏、阅读页、设置页等细节图
- CTA 链接：如果后面有官网域名、Chrome Web Store 地址，也可以直接换掉