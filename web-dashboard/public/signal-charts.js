const SignalCharts = (() => {
  const rangePresets = [
    { key: "1d", label: "1D" },
    { key: "15d", label: "15D" },
    { key: "1mo", label: "1M" },
    { key: "3mo", label: "3M" },
    { key: "6mo", label: "6M" },
    { key: "1y", label: "1Y" },
    { key: "3y", label: "3Y" },
    { key: "5y", label: "5Y" },
    { key: "10y", label: "10Y" },
    { key: "max", label: "Max" },
  ];
  const defaultRange = "1d";

  function formatMoney(value, currency = "USD", digits = 2) {
    if (value == null || Number.isNaN(value)) {
      return "N/A";
    }

    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  }

  function formatNumber(value, digits = 2) {
    if (value == null || Number.isNaN(value)) {
      return "N/A";
    }

    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  }

  function getRangeLabel(rangeKey) {
    return rangePresets.find((preset) => preset.key === rangeKey)?.label || rangeKey;
  }

  function formatTimestamp(value, rangeKey) {
    if (!value) {
      return "Unavailable";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    if (rangeKey === "1d") {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    }

    if (rangeKey === "15d" || rangeKey === "1mo" || rangeKey === "3mo" || rangeKey === "6mo") {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(date);
    }

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function buildXLabels(points, rangeKey) {
    if (!points.length) {
      return [];
    }

    const indexes = [
      0,
      Math.floor((points.length - 1) / 3),
      Math.floor(((points.length - 1) * 2) / 3),
      points.length - 1,
    ];

    return indexes.map((index) => formatTimestamp(points[index].timestamp || points[index].date, rangeKey));
  }

  function buildYLabels(values) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    return Array.from({ length: 4 }, (_, index) => ({
      value: max - (span * index) / 3,
      ratio: index / 3,
    }));
  }

  function drawChart(canvas, payload, sideLabelsEl, xLabelsEl, previousCloseEl, priceTagEl) {
    const points = payload.points;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.width;
    const cssHeight = Math.round(cssWidth * 0.42);
    const values = points.map((point) => point.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const latest = points[points.length - 1];
    const first = points[0];
    const delta = latest.close - first.close;
    const strokeColor = delta >= 0 ? "#188038" : "#d93025";

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = cssWidth;
    const height = cssHeight;
    const paddingTop = 10;
    const paddingBottom = 24;
    const chartHeight = height - paddingTop - paddingBottom;

    ctx.clearRect(0, 0, width, height);

    sideLabelsEl.innerHTML = "";
    buildYLabels(values).forEach((label) => {
      const y = paddingTop + chartHeight * label.ratio;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = "#eceff1";
      ctx.lineWidth = 1;
      ctx.stroke();

      const el = document.createElement("span");
      el.className = "chart-y-label";
      el.style.top = `${y}px`;
      el.textContent = formatNumber(label.value, 0);
      sideLabelsEl.appendChild(el);
    });

    const linePoints = values.map((value, index) => ({
      x: (width * index) / Math.max(values.length - 1, 1),
      y: paddingTop + ((max - value) / span) * chartHeight,
    }));

    ctx.beginPath();
    linePoints.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();

    const previousClose = payload.stats.previousClose;
    if (previousClose != null && !Number.isNaN(previousClose) && previousClose >= min && previousClose <= max) {
      const y = paddingTop + ((max - previousClose) / span) * chartHeight;
      ctx.beginPath();
      ctx.setLineDash([2, 5]);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = "#bdc1c6";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const last = linePoints[linePoints.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();

    xLabelsEl.innerHTML = "";
    buildXLabels(points, payload.range).forEach((label) => {
      const el = document.createElement("span");
      el.textContent = label;
      xLabelsEl.appendChild(el);
    });

    previousCloseEl.textContent =
      previousClose != null && !Number.isNaN(previousClose)
        ? `Previous close\n${formatMoney(previousClose, payload.currency)}`
        : "";

    priceTagEl.textContent = `${formatMoney(latest.close, payload.currency)} ${formatTimestamp(
      latest.timestamp || latest.date,
      payload.range
    )}`;
  }

  async function apiRequest(url) {
    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }
    return payload;
  }

  function createGlobalRangeController(storageKey, tabsEl, onChange) {
    let currentRange = localStorage.getItem(storageKey) || defaultRange;
    if (!rangePresets.some((preset) => preset.key === currentRange)) {
      currentRange = defaultRange;
    }

    const buttons = new Map();

    function updateButtons() {
      buttons.forEach((button, key) => {
        button.classList.toggle("active", key === currentRange);
        button.setAttribute("aria-pressed", String(key === currentRange));
      });
    }

    function setRange(range) {
      if (range === currentRange) {
        return;
      }

      currentRange = range;
      localStorage.setItem(storageKey, range);
      updateButtons();
      onChange(range);
    }

    rangePresets.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "range-pill";
      button.textContent = preset.label;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => setRange(preset.key));
      buttons.set(preset.key, button);
      tabsEl.appendChild(button);
    });

    updateButtons();

    return {
      getRange() {
        return currentRange;
      },
      setRange,
    };
  }

  return {
    apiRequest,
    createGlobalRangeController,
    defaultRange,
    drawChart,
    formatMoney,
    formatNumber,
    getRangeLabel,
    rangePresets,
  };
})();
