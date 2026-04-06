import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { ChartPreview } from "../components/ChartPreview";
import { MetricCard } from "../components/MetricCard";

const chartTypes = ["bar", "line", "scatter", "histogram", "box", "pie"];
const navItems = [
  { id: "overview", label: "Dashboard" },
  { id: "projects", label: "Projects" },
  { id: "ingest", label: "Upload" },
  { id: "preview", label: "Preview" },
  { id: "clean", label: "Clean" },
  { id: "eda", label: "EDA" },
  { id: "viz", label: "Visualize" },
  { id: "ml", label: "ML Training" },
];
const VIEW_KEY = "data_forge_active_view";
const PROJECT_KEY = "data_forge_active_project";

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function toPretty(value) {
  return String(value).replaceAll("_", " ");
}

function toTitle(value) {
  return toPretty(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function printDashboardPdf({ project, datasets, preview, cleaning, eda, visuals, training, history }) {
  const popup = window.open("", "_blank", "width=1280,height=900");
  if (!popup) throw new Error("Popup blocked. Allow popups to export the dashboard as PDF.");
  const safe = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const palette = ["#0f766e", "#ea580c", "#2563eb", "#dc2626", "#7c3aed", "#0891b2"];
  const chartMarkup = (visuals || []).map((chart) => {
    const points = chart.type === "pie" ? (chart.labels || []).map((label, index) => ({ label, value: Number(chart.values?.[index] ?? 0) })) : (chart.x || []).slice(0, 10).map((label, index) => ({ label, value: Number(chart.y?.[index] ?? 0) }));
    const max = Math.max(...points.map((point) => point.value), 1);
    let graphic = "";
    if (chart.type === "pie") {
      let angle = -Math.PI / 2;
      const slices = points.map((point, index) => {
        const slice = (point.value / (points.reduce((sum, item) => sum + item.value, 0) || 1)) * Math.PI * 2;
        const x1 = 160 + Math.cos(angle) * 90;
        const y1 = 120 + Math.sin(angle) * 90;
        angle += slice;
        const x2 = 160 + Math.cos(angle) * 90;
        const y2 = 120 + Math.sin(angle) * 90;
        const arc = slice > Math.PI ? 1 : 0;
        return `<path d="M160 120 L${x1} ${y1} A90 90 0 ${arc} 1 ${x2} ${y2} Z" fill="${palette[index % palette.length]}" />`;
      }).join("");
      const legend = points.map((point, index) => `<div class="print-legend-item"><span class="print-swatch" style="background:${palette[index % palette.length]}"></span><span>${safe(point.label)}</span><b>${point.value}</b></div>`).join("");
      graphic = `<div class="print-pie-layout"><svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="240" fill="#fff" rx="18" />${slices}</svg><div class="print-legend">${legend}</div></div>`;
    } else if (chart.type === "line") {
      const coords = points.map((point, index) => `${35 + index * (450 / Math.max(points.length - 1, 1))},${190 - (point.value / max) * 145}`).join(" ");
      const dots = points.map((point, index) => { const cx = 35 + index * (450 / Math.max(points.length - 1, 1)); const cy = 190 - (point.value / max) * 145; return `<circle cx="${cx}" cy="${cy}" r="5" fill="#2563eb" /><text x="${cx}" y="208" text-anchor="middle" font-size="11" fill="#14303d">${safe(String(point.label).slice(0, 10))}</text>`; }).join("");
      graphic = `<svg viewBox="0 0 520 250" xmlns="http://www.w3.org/2000/svg"><rect width="520" height="250" fill="#fff" rx="18" /><line x1="24" y1="190" x2="500" y2="190" stroke="#bfd0d8" stroke-width="2" /><polyline points="${coords}" fill="none" stroke="#2563eb" stroke-width="4" />${dots}</svg>`;
    } else if (chart.type === "scatter") {
      const dots = points.map((point, index) => { const cx = 35 + index * (450 / Math.max(points.length - 1, 1)); const cy = 190 - (point.value / max) * 145; return `<circle cx="${cx}" cy="${cy}" r="7" fill="${palette[index % palette.length]}" /><text x="${cx}" y="208" text-anchor="middle" font-size="11" fill="#14303d">${safe(String(point.label).slice(0, 10))}</text>`; }).join("");
      graphic = `<svg viewBox="0 0 520 250" xmlns="http://www.w3.org/2000/svg"><rect width="520" height="250" fill="#fff" rx="18" /><line x1="24" y1="190" x2="500" y2="190" stroke="#bfd0d8" stroke-width="2" /><line x1="24" y1="22" x2="24" y2="190" stroke="#bfd0d8" stroke-width="2" />${dots}</svg>`;
    } else {
      const slot = 520 / Math.max(points.length, 1);
      const bars = points.map((point, index) => { const height = Math.max((point.value / max) * 150, 4); const x = 30 + index * slot; const y = 190 - height; const width = Math.max(slot - 20, 18); const boxY = chart.type === "box" ? y + 30 : y; const boxH = chart.type === "box" ? Math.max(height - 30, 6) : height; return `<rect x="${x}" y="${boxY}" width="${width}" height="${boxH}" rx="10" fill="${palette[index % palette.length]}" opacity="0.88" /><text x="${x + width / 2}" y="208" text-anchor="middle" font-size="11" fill="#14303d">${safe(String(point.label).slice(0, 10))}</text>`; }).join("");
      graphic = `<svg viewBox="0 0 520 250" xmlns="http://www.w3.org/2000/svg"><rect width="520" height="250" fill="#fff" rx="18" /><line x1="24" y1="190" x2="500" y2="190" stroke="#bfd0d8" stroke-width="2" />${bars}</svg>`;
    }
    return `<article class="chart-print-card"><div class="print-card-head"><h3>${safe(chart.title)}</h3><span>${safe(chart.type)}</span></div>${graphic}</article>`;
  }).join("") || "<p>No visualizations generated yet.</p>";
  const cleaningRows = cleaning ? Object.entries(cleaning).filter(([key]) => key !== "header_map").map(([key, value]) => `<tr><td>${safe(toTitle(key))}</td><td>${safe(typeof value === "object" ? JSON.stringify(value) : String(value))}</td></tr>`).join("") : "<tr><td colspan='2'>No cleaning run yet</td></tr>";
  const missingRows = eda?.missing_values ? Object.entries(eda.missing_values).map(([key, value]) => `<tr><td>${safe(key)}</td><td>${value}</td><td>${eda.missing_percent?.[key] ?? 0}%</td></tr>`).join("") : "<tr><td colspan='3'>No EDA generated yet</td></tr>";
  const trainingRows = training ? Object.entries(training.metrics || {}).map(([key, value]) => `<tr><td>${safe(toTitle(key))}</td><td>${safe(typeof value === "object" ? JSON.stringify(value) : String(value))}</td></tr>`).join("") : "<tr><td colspan='2'>No model training yet</td></tr>";
  const featureRows = training?.top_features?.length ? training.top_features.map((item, index) => `<tr><td>${index + 1}</td><td>${safe(item.name)}</td><td>${item.importance}</td></tr>`).join("") : "<tr><td colspan='3'>No ranked features available</td></tr>";
  const historyRows = history?.length ? history.map((item) => `<tr><td>${safe(item.title)}</td><td>${safe(toTitle(item.run_type))}</td><td>${safe(item.dataset_name)}</td><td>${safe(new Date(item.created_at).toLocaleString())}</td></tr>`).join("") : "<tr><td colspan='4'>No history yet</td></tr>";
  const datasetRows = datasets?.length ? datasets.map((item) => `<tr><td>${safe(item.name)}</td><td>${item.row_count}</td><td>${item.column_count}</td><td>${safe(item.target_column || "-")}</td></tr>`).join("") : "<tr><td colspan='4'>No datasets uploaded</td></tr>";
  const previewHead = preview?.columns?.length ? preview.columns.map((column) => `<th>${safe(column)}</th>`).join("") : "<th>Preview</th>";
  const previewRows = preview?.rows?.length ? preview.rows.slice(0, 8).map((row) => `<tr>${preview.columns.map((column) => `<td>${safe(row[column] ?? "")}</td>`).join("")}</tr>`).join("") : "<tr><td>No preview available</td></tr>";
  popup.document.write(`<!doctype html><html><head><title>${safe(project?.name || "Data Forge Dashboard Report")}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#14303d;background:#fffdfa}.hero{padding:22px 24px;border-radius:24px;background:linear-gradient(135deg,#e8fff7,#eef4ff 55%,#fff3e8);margin-bottom:20px}.hero h1{margin:0 0 8px;font-size:32px}.hero p{margin:6px 0;color:#577082}.metrics,.grid,.chart-grid{display:grid;gap:16px}.metrics{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:18px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:18px}.chart-grid{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:18px}.metric,.card,.chart-print-card{border:1px solid #d9e4e9;border-radius:18px;padding:16px;background:#fff;break-inside:avoid}.metric strong{display:block;color:#577082;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.metric div{font-size:28px;margin-top:10px;font-weight:700}.print-card-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.print-card-head h3{margin:0;font-size:16px}.print-card-head span{padding:6px 10px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;text-transform:capitalize}.chart-print-card svg{width:100%;height:auto;display:block}.print-pie-layout{display:grid;grid-template-columns:1.1fr .9fr;gap:16px;align-items:center}.print-legend{display:grid;gap:8px}.print-legend-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:12px;background:#f8fafc}.print-swatch{width:12px;height:12px;border-radius:999px;display:inline-block}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e6edf2;text-align:left;padding:8px;vertical-align:top}@media print{body{margin:14px}}</style></head><body><div class='hero'><h1>${safe(project?.name || "Data Forge Dashboard")}</h1><p>${safe(project?.description || "Saved data science dashboard report")}</p><p>Exported at ${safe(new Date().toLocaleString())}</p></div><div class='metrics'><div class='metric'><strong>Datasets</strong><div>${datasets?.length || 0}</div></div><div class='metric'><strong>Rows</strong><div>${preview?.row_count || 0}</div></div><div class='metric'><strong>Columns</strong><div>${preview?.column_count || 0}</div></div><div class='metric'><strong>Train Split</strong><div>${training?.train_split_percentage || "Not run"}</div></div></div><div class='grid'><section class='card'><h2>Datasets</h2><table><thead><tr><th>Name</th><th>Rows</th><th>Columns</th><th>Target</th></tr></thead><tbody>${datasetRows}</tbody></table></section><section class='card'><h2>Cleaning Summary</h2><table><tbody>${cleaningRows}</tbody></table></section><section class='card'><h2>EDA Summary</h2><p>Rows: ${eda?.shape?.rows || 0}</p><p>Columns: ${eda?.shape?.columns || 0}</p><p>Duplicate rows: ${eda?.duplicate_rows || 0}</p><table><thead><tr><th>Column</th><th>Missing</th><th>Missing %</th></tr></thead><tbody>${missingRows}</tbody></table></section><section class='card'><h2>ML Summary</h2><p>Model: ${safe(training?.model_type || "Not trained")}</p><p>Target: ${safe(training?.target_column || "-")}</p><p>Train rows: ${training?.train_rows || 0}</p><p>Test rows: ${training?.test_rows || 0}</p><p>Score: ${safe(training?.score ?? "-")}</p><table><tbody>${trainingRows}</tbody></table><h3>Top Features</h3><table><thead><tr><th>#</th><th>Feature</th><th>Importance</th></tr></thead><tbody>${featureRows}</tbody></table></section></div><section class='card' style='margin-bottom:18px;'><h2>Visualizations</h2><div class='chart-grid'>${chartMarkup}</div></section><div class='grid'><section class='card'><h2>Dataset Preview</h2><table><thead><tr>${previewHead}</tr></thead><tbody>${previewRows}</tbody></table></section><section class='card'><h2>Process History</h2><table><thead><tr><th>Title</th><th>Type</th><th>Dataset</th><th>Created</th></tr></thead><tbody>${historyRows}</tbody></table></section></div><script>window.onload=()=>setTimeout(()=>window.print(),350);</script></body></html>`);
  popup.document.close();
}

export function WorkbenchPage({ user, onLogout }) {
  const [activeView, setActiveView] = useState(() => localStorage.getItem(VIEW_KEY) || "overview");
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(() => {
    const saved = localStorage.getItem(PROJECT_KEY);
    return saved ? Number(saved) : null;
  });
  const [datasets, setDatasets] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeDatasetId, setActiveDatasetId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [eda, setEda] = useState(null);
  const [visuals, setVisuals] = useState([]);
  const [training, setTraining] = useState(null);
  const [cleaningSummary, setCleaningSummary] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [cleaningForm, setCleaningForm] = useState({ drop_columns: [], fill_missing: "median", fill_categorical: "mode", remove_duplicates: true, trim_whitespace: true, normalize_headers: false, text_case: "none", drop_missing_rows: false, drop_empty_columns: false, drop_constant_columns: false, remove_outliers: false, cap_outliers: false, outlier_column: "", convert_column: "", convert_type: "number", round_numeric: false, round_digits: 2, target_column: "" });
  const [visualForm, setVisualForm] = useState({ x_axis: "", y_axis: "", color_by: "", chart_mode: "all", chart_type: "bar" });
  const [trainingForm, setTrainingForm] = useState({ target_column: "", model_type: "auto", train_split_percent: 80 });

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem(PROJECT_KEY, String(activeProjectId));
    }
  }, [activeProjectId]);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      loadProjectData(activeProjectId);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (activeProjectId && activeDatasetId) {
      loadPreview(activeProjectId, activeDatasetId);
    }
  }, [activeProjectId, activeDatasetId]);

  async function loadProjects() {
    try {
      const list = await api.listProjects();
      if (!list.length) {
        const starter = await api.createProject({ name: "Starter Project", description: "Auto-created project for your first upload" });
        setProjects([starter]);
        setActiveProjectId(starter.id);
        setMessage("Starter project created. You can upload data now.");
        return;
      }
      setProjects(list);
      const savedProject = localStorage.getItem(PROJECT_KEY);
      const matched = savedProject ? list.find((project) => project.id === Number(savedProject)) : null;
      setActiveProjectId((current) => current || matched?.id || list[0].id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadProjectData(projectId) {
    try {
      const [datasetList, dashboardData, historyData] = await Promise.all([api.listDatasets(projectId), api.getDashboard(projectId), api.getHistory(projectId)]);
      setDatasets(datasetList);
      setVisuals(dashboardData.latest_visualizations || []);
      setTraining(dashboardData.latest_training || null);
      setEda(dashboardData.latest_eda || null);
      setCleaningSummary(dashboardData.latest_cleaning || null);
      setHistory(historyData.history || []);
      setActiveDatasetId((current) => (datasetList.some((dataset) => dataset.id === current) ? current : datasetList[0]?.id || null));
      if (!datasetList.length) {
        setPreview(null);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadPreview(projectId, datasetId) {
    try {
      const data = await api.previewDataset(projectId, datasetId);
      setPreview(data);
      setCleaningForm((current) => ({ ...current, target_column: current.target_column || data.columns[0] || "", outlier_column: current.outlier_column || data.columns[0] || "", convert_column: current.convert_column || data.columns[0] || "" }));
      setTrainingForm((current) => ({ ...current, target_column: current.target_column || data.columns[0] || "" }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleProjectCreate() {
    setError("");
    try {
      const name = `Project ${projects.length + 1}`;
      const description = `Saved workspace created on ${new Date().toLocaleDateString()}`;
      const project = await api.createProject({ name, description });
      setProjects((current) => [project, ...current]);
      setActiveProjectId(project.id);
      setActiveView("overview");
      setMessage("Project created successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleProjectDelete(projectId = activeProjectId) {
    if (!projectId) return;
    setError("");
    try {
      await api.deleteProject(projectId);
      const remaining = projects.filter((project) => project.id !== projectId);
      setProjects(remaining);
      setActiveProjectId(remaining[0]?.id || null);
      setActiveDatasetId(null);
      setPreview(null);
      setHistory([]);
      setCleaningSummary(null);
      setEda(null);
      setTraining(null);
      setVisuals([]);
      setMessage("Project deleted successfully.");
      if (!remaining.length) {
        await loadProjects();
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDatasetUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.dataset;
    setError("");
    setMessage("");
    if (!activeProjectId) {
      setError("Create or select a project before uploading data.");
      return;
    }
    const file = fileInput?.files?.[0];
    if (!file) {
      setError("Choose a CSV or Excel file first.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    try {
      const dataset = await api.uploadDataset(activeProjectId, formData);
      setMessage(`${dataset.name} uploaded and saved.`);
      setSelectedFileName(file.name);
      await loadProjectData(activeProjectId);
      setActiveDatasetId(dataset.id);
      setActiveView("overview");
      form.reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleClean() {
    setError("");
    try {
      await api.cleanDataset(activeProjectId, activeDatasetId, { drop_columns: cleaningForm.drop_columns, fill_missing: cleaningForm.fill_missing, fill_categorical: cleaningForm.fill_categorical, remove_duplicates: cleaningForm.remove_duplicates, trim_whitespace: cleaningForm.trim_whitespace, normalize_headers: cleaningForm.normalize_headers, text_case: cleaningForm.text_case, drop_missing_rows: cleaningForm.drop_missing_rows, drop_empty_columns: cleaningForm.drop_empty_columns, drop_constant_columns: cleaningForm.drop_constant_columns, remove_outliers: cleaningForm.remove_outliers, cap_outliers: cleaningForm.cap_outliers, outlier_column: cleaningForm.outlier_column || null, convert_column: cleaningForm.convert_column || null, convert_type: cleaningForm.convert_type || null, round_numeric: cleaningForm.round_numeric, round_digits: Number(cleaningForm.round_digits || 2), target_column: cleaningForm.target_column || null });
      setMessage("Cleaning completed and dataset updated.");
      await loadProjectData(activeProjectId);
      await loadPreview(activeProjectId, activeDatasetId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleEda() {
    setError("");
    try {
      setEda(await api.getEda(activeProjectId, activeDatasetId));
      setMessage("EDA summary generated.");
      await loadProjectData(activeProjectId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleVisualize() {
    setError("");
    try {
      const chosenTypes = visualForm.chart_mode === "all" ? chartTypes : [visualForm.chart_type];
      const result = await api.getVisualizations(activeProjectId, activeDatasetId, { chart_types: chosenTypes, x_axis: visualForm.x_axis || null, y_axis: visualForm.y_axis || null, color_by: visualForm.color_by || null });
      setVisuals(result.charts);
      setMessage(visualForm.chart_mode === "all" ? "All visualizations refreshed." : `${visualForm.chart_type} visualization generated.`);
      await loadProjectData(activeProjectId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTrain() {
    setError("");
    try {
      const result = await api.trainModel(activeProjectId, activeDatasetId, { target_column: trainingForm.target_column, model_type: trainingForm.model_type, train_split: Number(trainingForm.train_split_percent) / 100 });
      setTraining(result);
      setMessage("Training completed and dashboard metrics updated.");
      await loadProjectData(activeProjectId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDatasetDownload() {
    try {
      const blob = await api.downloadDataset(activeProjectId, activeDatasetId);
      downloadBlob(blob, datasets.find((dataset) => dataset.id === activeDatasetId)?.name || "dataset.csv");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDashboardExport() {
    try {
      printDashboardPdf({ project: projects.find((project) => project.id === activeProjectId) || null, datasets, preview, cleaning: cleaningSummary, eda, visuals, training, history });
      setMessage("Print dialog opened. Save it as PDF from the print window.");
    } catch (err) {
      setError(err.message);
    }
  }

  const columns = useMemo(() => preview?.columns || [], [preview]);
  const numericColumns = useMemo(() => preview?.columns?.filter((column) => preview.rows?.some((row) => row[column] !== "" && !Number.isNaN(Number(row[column])))) || [], [preview]);
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;

  function renderDescribeTable() {
    if (!eda?.describe || !Object.keys(eda.describe).length) {
      return <p className="empty-state">No numeric summary available yet.</p>;
    }
    const stats = Object.keys(eda.describe);
    const metrics = Object.keys(eda.describe[stats[0]] || {});
    return <div className="table-shell"><table><thead><tr><th>Metric</th>{stats.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric}><td>{metric}</td>{stats.map((column) => <td key={`${column}-${metric}`}>{String(eda.describe[column]?.[metric] ?? "")}</td>)}</tr>)}</tbody></table></div>;
  }

  function renderEdaDetails() {
    if (!eda) {
      return <p className="empty-state">Run EDA to generate the full analysis details.</p>;
    }
    return <div className="eda-grid"><article className="panel"><h3>Shape and types</h3><div className="info-block"><p>Rows: {eda.shape.rows}</p><p>Columns: {eda.shape.columns}</p></div><div className="table-shell"><table><thead><tr><th>Column</th><th>Type</th><th>Missing</th></tr></thead><tbody>{eda.columns.map((column) => <tr key={column}><td>{column}</td><td>{eda.dtypes[column]}</td><td>{eda.missing_values[column] ?? 0}</td></tr>)}</tbody></table></div></article><article className="panel"><h3>Numeric summary</h3>{renderDescribeTable()}</article><article className="panel"><h3>Correlations</h3>{Object.keys(eda.correlations || {}).length ? <div className="table-shell"><table><thead><tr><th>Column</th>{Object.keys(eda.correlations).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{Object.keys(eda.correlations).map((rowKey) => <tr key={rowKey}><td>{rowKey}</td>{Object.keys(eda.correlations).map((column) => <td key={`${rowKey}-${column}`}>{String(eda.correlations[rowKey]?.[column] ?? "")}</td>)}</tr>)}</tbody></table></div> : <p className="empty-state">Not enough numeric columns for correlation.</p>}</article><article className="panel"><h3>Categorical summary</h3>{Object.keys(eda.categorical_summary || {}).length ? Object.entries(eda.categorical_summary).map(([column, values]) => <div key={column} className="summary-block"><strong>{column}</strong><div className="mini-table">{Object.entries(values).map(([label, count]) => <div key={`${column}-${label}`}><span>{label}</span><b>{count}</b></div>)}</div></div>) : <p className="empty-state">No categorical summary available.</p>}</article></div>;
  }

  function renderProjectsView() {
    return <section className="workspace-single"><article className="panel"><div className="section-header"><div><h3>Project workspace</h3><p className="section-copy">Open any project directly into its dashboard. Delete old projects from the right side of each row.</p></div><button type="button" onClick={handleProjectCreate}>Create new project</button></div><div className="project-list project-list-large">{projects.map((project) => <div key={project.id} className={project.id === activeProjectId ? "project-row active" : "project-row"}><button type="button" className="project-main" onClick={() => { setActiveProjectId(project.id); setActiveView("overview"); }}><strong>{project.name}</strong><span>{project.description || "No description"}</span></button><button type="button" className="project-delete" onClick={() => handleProjectDelete(project.id)}>Delete</button></div>)}</div></article></section>;
  }

  function renderPreviewView() {
    return <section className="workspace-single"><article className="panel"><div className="section-header"><div><h3>Data preview</h3><p className="section-copy">Review rows, columns, and structure before cleaning, EDA, or ML training.</p></div><button type="button" onClick={handleDatasetDownload} disabled={!activeDatasetId}>Download current dataset</button></div><section className="metrics-grid preview-metrics"><MetricCard label="Rows" value={preview?.row_count || 0} helper="Observed rows" /><MetricCard label="Columns" value={preview?.column_count || 0} helper="Detected columns" /><MetricCard label="Numeric" value={numericColumns.length} helper="Numeric candidates" /><MetricCard label="Target" value={trainingForm.target_column || "-"} helper="Selected target" /></section>{preview?.rows?.length ? <div className="table-shell"><table><thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={`${index}-${column}`}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div> : <p className="empty-state">Upload a dataset to see the preview.</p>}</article></section>;
  }

  function renderOverview() {
    return <>
      <section className="dashboard-hero panel panel-hero"><div><p className="eyebrow">Executive Dashboard</p><h2>{activeProject?.name || "Project dashboard"}</h2><p>{activeProject?.description || "Track ingestion, cleaning, EDA, visualizations, model training, and history from one dashboard."}</p></div><div className="dashboard-actions"><button type="button" onClick={() => setActiveView("ingest")}>Add dataset</button><button type="button" onClick={() => setActiveView("ml")} disabled={!activeDatasetId}>Run training</button></div></section>
      <section className="metrics-grid">
        <MetricCard label="Datasets" value={datasets.length} helper="Saved for this project" />
        <MetricCard label="Rows" value={preview?.row_count || 0} helper="Current dataset rows" />
        <MetricCard label="Columns" value={preview?.column_count || 0} helper="Current dataset columns" />
        <MetricCard label="Train Split" value={training ? `${training.train_split_percentage}%` : `${trainingForm.train_split_percent}%`} helper="ML training percentage" />
      </section>
      <section className="dashboard-grid">
        <article className="panel"><h3>Cleaning Status</h3>{cleaningSummary ? <div className="info-block"><p>Rows before: {cleaningSummary.rows_before}</p><p>Rows after: {cleaningSummary.rows_after}</p><p>Dropped columns: {(cleaningSummary.dropped_columns || []).join(", ") || "None"}</p><p>Duplicates removed: {cleaningSummary.duplicates_removed}</p><p>Outliers removed: {cleaningSummary.outliers_removed}</p><p>Conversion: {cleaningSummary.conversion?.target_type || "Not used"}</p></div> : <p className="empty-state">No cleaning run yet.</p>}</article>
        <article className="panel"><h3>EDA Snapshot</h3>{eda ? <div className="info-block"><p>Rows: {eda.shape.rows}</p><p>Columns: {eda.shape.columns}</p><p>Missing tracked: {Object.keys(eda.missing_values || {}).length}</p><p>Correlation matrix: {Object.keys(eda.correlations || {}).length ? "Available" : "Not enough numeric columns"}</p></div> : <p className="empty-state">No EDA summary yet.</p>}</article>
        <article className="panel"><h3>ML Training</h3>{training ? <div className="info-block"><p>Model: {training.model_type}</p><p>Target: {training.target_column}</p><p>Train split: {training.train_split_percentage}%</p><p>Train rows: {training.train_rows}</p><p>Test rows: {training.test_rows}</p><p>Score: {training.score}</p></div> : <p className="empty-state">No model trained yet.</p>}</article>
      </section>
      <section className="panel"><h3>Visualizations</h3><div className="chart-grid">{visuals.length ? visuals.map((chart, index) => <ChartPreview key={`${chart.type}-${index}`} chart={chart} />) : <p className="empty-state">Charts generated in visualization will appear here.</p>}</div></section>
      <section className="dashboard-grid">
        <article className="panel"><h3>Recent Projects</h3><div className="project-list">{projects.slice(0, 5).map((project) => <div key={project.id} className={project.id === activeProjectId ? "project-row active" : "project-row"}><button type="button" className="project-main" onClick={() => { setActiveProjectId(project.id); setActiveView("overview"); }}><strong>{project.name}</strong><span>{project.description || "No description"}</span></button><button type="button" className="project-delete" onClick={() => handleProjectDelete(project.id)}>Delete</button></div>)}</div></article>
        <article className="panel"><h3>Process Timeline</h3><div className="history-list">{history.length ? history.slice(0, 6).map((item) => <article key={item.id} className="history-card"><strong>{item.title}</strong><span>{toPretty(item.run_type)} on {item.dataset_name}</span><small>{new Date(item.created_at).toLocaleString()}</small></article>) : <p className="empty-state">No process history yet.</p>}</div></article>
      </section>
      <section className="panel"><h3>Dataset Preview</h3>{preview?.rows?.length ? <div className="table-shell"><table><thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={`${index}-${column}`}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div> : <p className="empty-state">Upload a dataset to preview it here.</p>}</section>
    </>;
  }

  function renderIngest() {
    return <section className="workspace-single"><article className="panel"><h3>Upload dataset</h3><p className="section-copy">Choose a CSV or Excel file. Invalid files are rejected and will not be saved into project history.</p><form className="upload-form" onSubmit={handleDatasetUpload}><input name="dataset" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setSelectedFileName(e.target.files?.[0]?.name || "")} /><div className="upload-summary"><span>{selectedFileName || "No file selected yet"}</span><span>{activeProjectId ? `Project #${activeProjectId} selected` : "No project selected"}</span></div><button type="submit" disabled={!activeProjectId || uploading}>{uploading ? "Uploading..." : "Upload dataset"}</button></form></article></section>;
  }

  function renderClean() {
    return <section className="workspace-single"><article className="panel"><div className="section-header"><div><h3>Cleaning Workspace</h3><p className="section-copy">Apply professional preprocessing methods only for cleaning here. Choose the methods you need, then run the pipeline once.</p></div><button type="button" onClick={handleClean} disabled={!activeDatasetId}>Run cleaning</button></div><div className="cleaning-grid"><article className="panel inner-panel"><h4>Column selection</h4><label>Drop selected columns</label><select multiple value={cleaningForm.drop_columns} onChange={(e) => setCleaningForm({ ...cleaningForm, drop_columns: Array.from(e.target.selectedOptions).map((option) => option.value) })}>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select><label>Convert column type</label><select value={cleaningForm.convert_column} onChange={(e) => setCleaningForm({ ...cleaningForm, convert_column: e.target.value })}><option value="">Select column</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select><label>Convert target type</label><select value={cleaningForm.convert_type} onChange={(e) => setCleaningForm({ ...cleaningForm, convert_type: e.target.value })}><option value="number">Number</option><option value="string">Text</option><option value="date">Date</option></select></article><article className="panel inner-panel"><h4>Missing values and text quality</h4><label>Numeric missing value method</label><select value={cleaningForm.fill_missing} onChange={(e) => setCleaningForm({ ...cleaningForm, fill_missing: e.target.value })}><option value="median">Median</option><option value="mean">Mean</option><option value="mode">Mode</option><option value="zero">Zero</option></select><label>Categorical missing value method</label><select value={cleaningForm.fill_categorical} onChange={(e) => setCleaningForm({ ...cleaningForm, fill_categorical: e.target.value })}><option value="mode">Mode</option><option value="unknown">Unknown</option><option value="empty">Empty string</option></select><label>Text case standardization</label><select value={cleaningForm.text_case} onChange={(e) => setCleaningForm({ ...cleaningForm, text_case: e.target.value })}><option value="none">Keep original</option><option value="lower">lowercase</option><option value="upper">UPPERCASE</option><option value="title">Title Case</option></select><div className="toggle-grid"><label className="checkbox"><input type="checkbox" checked={cleaningForm.trim_whitespace} onChange={(e) => setCleaningForm({ ...cleaningForm, trim_whitespace: e.target.checked })} />Trim whitespace</label><label className="checkbox"><input type="checkbox" checked={cleaningForm.normalize_headers} onChange={(e) => setCleaningForm({ ...cleaningForm, normalize_headers: e.target.checked })} />Normalize headers</label><label className="checkbox"><input type="checkbox" checked={cleaningForm.remove_duplicates} onChange={(e) => setCleaningForm({ ...cleaningForm, remove_duplicates: e.target.checked })} />Remove duplicates</label><label className="checkbox"><input type="checkbox" checked={cleaningForm.drop_missing_rows} onChange={(e) => setCleaningForm({ ...cleaningForm, drop_missing_rows: e.target.checked })} />Drop rows with missing values</label></div></article><article className="panel inner-panel"><h4>Structure and numeric controls</h4><label>Outlier column</label><select value={cleaningForm.outlier_column} onChange={(e) => setCleaningForm({ ...cleaningForm, outlier_column: e.target.value })}><option value="">Select numeric column</option>{numericColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select><div className="toggle-grid"><label className="checkbox"><input type="checkbox" checked={cleaningForm.drop_empty_columns} onChange={(e) => setCleaningForm({ ...cleaningForm, drop_empty_columns: e.target.checked })} />Drop empty columns</label><label className="checkbox"><input type="checkbox" checked={cleaningForm.drop_constant_columns} onChange={(e) => setCleaningForm({ ...cleaningForm, drop_constant_columns: e.target.checked })} />Drop constant columns</label><label className="checkbox"><input type="checkbox" checked={cleaningForm.remove_outliers} onChange={(e) => setCleaningForm({ ...cleaningForm, remove_outliers: e.target.checked, cap_outliers: e.target.checked ? false : cleaningForm.cap_outliers })} />Remove outliers using IQR</label><label className="checkbox"><input type="checkbox" checked={cleaningForm.cap_outliers} onChange={(e) => setCleaningForm({ ...cleaningForm, cap_outliers: e.target.checked, remove_outliers: e.target.checked ? false : cleaningForm.remove_outliers })} />Cap outliers to IQR bounds</label><label className="checkbox"><input type="checkbox" checked={cleaningForm.round_numeric} onChange={(e) => setCleaningForm({ ...cleaningForm, round_numeric: e.target.checked })} />Round numeric columns</label></div><label>Round digits</label><input type="number" min="0" max="8" value={cleaningForm.round_digits} onChange={(e) => setCleaningForm({ ...cleaningForm, round_digits: e.target.value })} /><div className="info-block note-block"><p>Recommended order:</p><p>1. Fix headers and text quality</p><p>2. Remove empty or constant columns</p><p>3. Handle missing values and duplicates</p><p>4. Treat outliers and round numeric fields</p></div></article></div>{cleaningSummary ? <article className="panel result-panel"><h4>Last cleaning result</h4><div className="detail-grid"><div><span>Rows before</span><b>{cleaningSummary.rows_before}</b></div><div><span>Rows after</span><b>{cleaningSummary.rows_after}</b></div><div><span>Missing after</span><b>{cleaningSummary.missing_after}</b></div><div><span>Duplicates removed</span><b>{cleaningSummary.duplicates_removed}</b></div><div><span>Outliers removed</span><b>{cleaningSummary.outliers_removed}</b></div><div><span>Outliers capped</span><b>{cleaningSummary.outliers_capped}</b></div></div></article> : null}</article></section>;
  }

  function renderEda() {
    return <section className="workspace-single"><article className="panel"><div className="section-header"><h3>EDA details</h3><button type="button" onClick={handleEda} disabled={!activeDatasetId}>Generate EDA</button></div>{renderEdaDetails()}</article></section>;
  }

  function renderViz() {
    return <section className="workspace-single"><article className="panel"><h3>Visualizations</h3><div className="form-grid-2"><div><label>Visualization mode</label><select value={visualForm.chart_mode} onChange={(e) => setVisualForm({ ...visualForm, chart_mode: e.target.value })}><option value="all">Generate all chart types</option><option value="single">Generate one selected chart</option></select></div><div><label>Chart type</label><select value={visualForm.chart_type} onChange={(e) => setVisualForm({ ...visualForm, chart_type: e.target.value })} disabled={visualForm.chart_mode === "all"}>{chartTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></div><div><label>X axis</label><select value={visualForm.x_axis} onChange={(e) => setVisualForm({ ...visualForm, x_axis: e.target.value })}><option value="">Auto</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></div><div><label>Y axis</label><select value={visualForm.y_axis} onChange={(e) => setVisualForm({ ...visualForm, y_axis: e.target.value })}><option value="">Auto</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></div><div><label>Color by</label><select value={visualForm.color_by} onChange={(e) => setVisualForm({ ...visualForm, color_by: e.target.value })}><option value="">None</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></div></div><button type="button" onClick={handleVisualize} disabled={!activeDatasetId}>{visualForm.chart_mode === "all" ? "Generate all visualizations" : `Generate ${visualForm.chart_type}`}</button><div className="chart-grid">{visuals.length ? visuals.map((chart, index) => <ChartPreview key={`${chart.type}-${index}`} chart={chart} />) : <p className="empty-state">No charts yet.</p>}</div></article></section>;
  }

  function renderMl() {
    return <section className="workspace-single"><article className="panel"><div className="section-header"><div><h3>ML training</h3><p className="section-copy">Configure the target, model family, and train split percentage, then save the full training result back into the dashboard.</p></div><button type="button" onClick={handleTrain} disabled={!activeDatasetId || !trainingForm.target_column}>Train model</button></div><div className="form-grid-2"><div><label>Target column</label><select value={trainingForm.target_column} onChange={(e) => setTrainingForm({ ...trainingForm, target_column: e.target.value })}><option value="">Select target</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></div><div><label>Model type</label><select value={trainingForm.model_type} onChange={(e) => setTrainingForm({ ...trainingForm, model_type: e.target.value })}><option value="auto">Auto best model</option><option value="random_forest">Random Forest</option><option value="linear">Linear / Logistic</option></select></div><div><label>Train split percentage</label><input type="number" min="60" max="90" step="5" value={trainingForm.train_split_percent} onChange={(e) => setTrainingForm({ ...trainingForm, train_split_percent: e.target.value })} /></div></div>{training ? <div className="training-grid"><article className="panel inner-panel"><h4>Training summary</h4><div className="detail-grid"><div><span>Model</span><b>{training.model_type}</b></div><div><span>Target</span><b>{training.target_column}</b></div><div><span>Problem type</span><b>{training.metrics?.problem_type}</b></div><div><span>Train split</span><b>{training.train_split_percentage}%</b></div><div><span>Train rows</span><b>{training.train_rows}</b></div><div><span>Test rows</span><b>{training.test_rows}</b></div><div><span>Train score</span><b>{training.train_score}</b></div><div><span>Test score</span><b>{training.test_score}</b></div></div></article><article className="panel inner-panel"><h4>Metrics</h4><div className="mini-table">{Object.entries(training.metrics || {}).map(([key, value]) => <div key={key}><span>{toTitle(key)}</span><b>{typeof value === "object" ? JSON.stringify(value) : String(value)}</b></div>)}</div></article><article className="panel inner-panel"><h4>Dataset and features</h4><div className="detail-grid"><div><span>Total rows</span><b>{training.total_rows}</b></div><div><span>Feature count</span><b>{training.feature_count}</b></div><div><span>Numeric features</span><b>{training.numeric_feature_count}</b></div><div><span>Categorical features</span><b>{training.categorical_feature_count}</b></div></div></article><article className="panel inner-panel training-full-span"><h4>Top feature drivers</h4>{training.top_features?.length ? <div className="table-shell"><table><thead><tr><th>#</th><th>Feature</th><th>Importance</th></tr></thead><tbody>{training.top_features.map((item, index) => <tr key={`${item.name}-${index}`}><td>{index + 1}</td><td>{item.name}</td><td>{item.importance}</td></tr>)}</tbody></table></div> : <p className="empty-state">Feature ranking is not available for this model.</p>}</article><article className="panel inner-panel training-full-span"><h4>Prediction preview</h4>{training.prediction_preview?.length ? <div className="table-shell"><table><thead><tr><th>Actual</th><th>Predicted</th></tr></thead><tbody>{training.prediction_preview.map((item, index) => <tr key={`${item.actual}-${item.predicted}-${index}`}><td>{item.actual}</td><td>{item.predicted}</td></tr>)}</tbody></table></div> : <p className="empty-state">Prediction preview will appear after training.</p>}</article></div> : <p className="empty-state">Train a model to see detailed metrics here.</p>}</article></section>;
  }

  return <main className="app-shell"><aside className="nav-sidebar"><div className="sidebar-top"><div><p className="eyebrow">Signed in</p><h2>{user.full_name}</h2><p>{user.email}</p></div><button type="button" className="logout-btn" onClick={onLogout}>Logout</button></div><nav className="sidebar-nav">{navItems.map((item) => <button type="button" key={item.id} className={activeView === item.id ? "nav-pill active" : "nav-pill"} onClick={() => setActiveView(item.id)}>{item.label}</button>)}</nav></aside><section className="main-content"><header className="hero hero-pro"><div><p className="eyebrow">Data Forge workspace</p><h1>Build a professional data workflow from upload to dashboard export.</h1></div><div className="hero-actions"><button type="button" onClick={handleDashboardExport} disabled={!activeProjectId}>Export PDF</button><button type="button" onClick={handleDatasetDownload} disabled={!activeDatasetId}>Download dataset</button></div></header>{message ? <p className="status-banner">{message}</p> : null}{error ? <p className="error-banner">{error}</p> : null}{activeView === "overview" ? renderOverview() : null}{activeView === "projects" ? renderProjectsView() : null}{activeView === "ingest" ? renderIngest() : null}{activeView === "preview" ? renderPreviewView() : null}{activeView === "clean" ? renderClean() : null}{activeView === "eda" ? renderEda() : null}{activeView === "viz" ? renderViz() : null}{activeView === "ml" ? renderMl() : null}</section><aside className="history-rail"><section className="panel"><div className="rail-header"><h3>Projects</h3><button type="button" className="danger-link" onClick={handleProjectDelete} disabled={!activeProjectId}>Delete current</button></div><button type="button" onClick={handleProjectCreate}>Create new project</button><div className="project-list">{projects.map((project) => <div key={project.id} className={project.id === activeProjectId ? "project-row active" : "project-row"}><button type="button" className="project-main" onClick={() => { setActiveProjectId(project.id); setActiveView("overview"); }}><strong>{project.name}</strong><span>{project.description || "No description"}</span></button><button type="button" className="project-delete" onClick={() => handleProjectDelete(project.id)}>Delete</button></div>)}</div></section><section className="panel"><h3>Datasets</h3><div className="dataset-list">{datasets.length ? datasets.map((dataset) => <button type="button" key={dataset.id} className={dataset.id === activeDatasetId ? "dataset-item active" : "dataset-item"} onClick={() => { setActiveDatasetId(dataset.id); setActiveView("overview"); }}><strong>{dataset.name}</strong><span>{dataset.row_count} rows, {dataset.column_count} columns</span></button>) : <p className="empty-state">No datasets yet.</p>}</div></section><section className="panel"><h3>History</h3><div className="history-list">{history.length ? history.map((item) => <article key={item.id} className="history-card"><strong>{item.title}</strong><span>{toPretty(item.run_type)} on {item.dataset_name}</span><small>{new Date(item.created_at).toLocaleString()}</small></article>) : <p className="empty-state">No history yet.</p>}</div></section></aside></main>;
}












