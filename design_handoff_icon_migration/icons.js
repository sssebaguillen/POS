/* Pulsar POS — UI kit icons. Official set: Phosphor (regular) via Iconify.
   Renders real, themeable inline SVG (currentColor). → window.POSIcons */
(function () {
  // size → width/height; color inherits via currentColor.
  const I = (name) => ({ size = 18, style, ...p }) =>
    React.createElement("iconify-icon", {
      icon: name,
      width: size,
      height: size,
      style: { display: "inline-flex", ...style },
      ...p,
    });

  const Icons = {
    ShoppingCart: I("ph:shopping-cart"),
    Users: I("ph:users"),
    Inbox: I("ph:tray"),
    BarChart2: I("ph:chart-bar"),
    LineChart: I("ph:chart-line"),
    History: I("ph:clock-counter-clockwise"),
    Receipt: I("ph:receipt"),
    Vault: I("ph:vault"),
    Package: I("ph:package"),
    ClipboardList: I("ph:clipboard-text"),
    BadgePercent: I("ph:seal-percent"),
    Settings: I("ph:gear"),
    Globe: I("ph:globe"),
    Search: I("ph:magnifying-glass"),
    ScanBarcode: I("ph:barcode"),
    ChevronDown: I("ph:caret-down"),
    Check: I("ph:check"),
    Minus: I("ph:minus"),
    Plus: I("ph:plus"),
    Trash2: I("ph:trash"),
    User: I("ph:user"),
    Percent: I("ph:percent"),
    PenLine: I("ph:pencil-simple"),
    Moon: I("ph:moon"),
    PanelLeftClose: I("ph:sidebar-simple"),
    X: I("ph:x"),
  };

  window.POSIcons = Icons;
})();
