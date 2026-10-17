# 自定义部件入门包（可加载格式 0.1）

`pack.json` 可由部件包加载器导入：对白框/姓名栏与角标装饰两项定义，panel/text 元素、系统字体、零图片依赖。导入仅登记定义，不自动创建实例；随后显式添加到场景。

`preview.svg` 只是 960×540 静态示意，不作为生产图片资源，不随 JSON 自动生成。

## 自己制作

1. 复制目录，修改包 id/name/version。包内定义与元素 id 各自唯一，导入会生成新的工程定义 ID。
2. 修改 designSize、elements[].rect、fill、radius、fontSize、color。坐标均为部件局部设计像素。实例仅支持等比缩放。
3. 正文使用 `binding: "activeDialogue.text"`，姓名使用 `activeDialogue.speakerName`，固定文字使用 `text`；binding 与 text 必须二选一。
4. 实例添加时指定画布位置。建议对白框 x=40/y=350，角标 x=30/y=24（960×540 画布），这些建议不写入 manifest。
5. 图片皮肤放在 assets 子目录，resources 登记下面对象，并加入对应 image 元素。必须提供真实 PNG/JPEG，不能只是改扩展名。

```json
{
  "resourceExample": {"id": "skin", "path": "assets/skin.png"},
  "elementExample": {
    "id": "skin-image", "type": "image", "resourceId": "skin",
    "rect": {"x": 0, "y": 28, "width": 880, "height": 132}, "fit": "contain"
  }
}
```

以上是示例片段，不是完整包：两个对象分别加入 resources / elements 数组。资源声明严格只有 id/path，kind/mime/尺寸由加载器验证后登记。

## 白名单与安全边界

- format=`replay-component-pack`，formatVersion=`0.1`。未知字段或版本拒绝，不使用旧草案 status/suggestedPlacement。
- 元素只支持 panel/text/image；颜色 #RRGGBB 或 #RRGGBBAA；字体 Microsoft YaHei、Segoe UI、Arial、sans-serif、serif、monospace。
- 不接受脚本、HTML/CSS 字段、URL 资源、自带字体、SVG、绝对路径、`..`、符号链接或目录联接。literal text 按普通文本显示，绝不执行。
- manifest ≤1MiB；资源 ≤100 个、每个 ≤32MiB、总计含 manifest ≤128MiB；图片还需通过真实结构和主进程字节解码检查。
- 主进程系统对话框授权目录；验证及 staging 原子复制后，资源与定义一次工程事务登记。失败回滚，不改作者源文件。
- 成功复制保留以支持 undo/redo、portable 另存及恢复；删除实例不删除资源或定义。已有实例不依赖作者目录。

本例为原创简单几何，可自由修改。系统字体不随包分发，最终字体授权由使用者确认。
