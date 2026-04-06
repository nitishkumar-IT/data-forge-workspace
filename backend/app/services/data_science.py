import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, mean_absolute_error, mean_squared_error, precision_score, r2_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier, XGBRegressor

from ..config import MODEL_DIR


PALETTE = ["#0f766e", "#ea580c", "#2563eb", "#dc2626", "#7c3aed", "#0891b2"]


def load_dataset(path: str | Path) -> pd.DataFrame:
    file_path = Path(path)
    if file_path.suffix.lower() == ".csv":
        return pd.read_csv(file_path)
    if file_path.suffix.lower() in {".xlsx", ".xls"}:
        return pd.read_excel(file_path)
    raise ValueError("Only CSV and Excel files are supported")


def _normalize_headers(columns: list[str]) -> list[str]:
    normalized = []
    used = set()
    for column in columns:
        value = str(column).strip().lower().replace(" ", "_")
        value = "".join(char for char in value if char.isalnum() or char == "_") or "column"
        candidate = value
        counter = 1
        while candidate in used:
            counter += 1
            candidate = f"{value}_{counter}"
        used.add(candidate)
        normalized.append(candidate)
    return normalized


def _convert_column_type(frame: pd.DataFrame, column: str | None, target_type: str | None) -> tuple[pd.DataFrame, dict[str, Any] | None]:
    if not column or not target_type or column not in frame.columns:
        return frame, None
    converted = frame.copy()
    converted_cells = 0
    if target_type == "number":
        before_notna = converted[column].notna().sum()
        converted[column] = pd.to_numeric(converted[column], errors="coerce")
        converted_cells = int(converted[column].notna().sum())
        converted_cells = min(int(before_notna), converted_cells)
    elif target_type == "string":
        converted[column] = converted[column].astype(str)
        converted_cells = int(len(converted))
    elif target_type == "date":
        converted[column] = pd.to_datetime(converted[column], errors="coerce")
        converted_cells = int(converted[column].notna().sum())
    return converted, {"column": column, "target_type": target_type, "converted_cells": converted_cells}


def _apply_text_case(series: pd.Series, text_case: str) -> pd.Series:
    if text_case == "lower":
        return series.apply(lambda value: value.lower() if isinstance(value, str) else value)
    if text_case == "upper":
        return series.apply(lambda value: value.upper() if isinstance(value, str) else value)
    if text_case == "title":
        return series.apply(lambda value: value.title() if isinstance(value, str) else value)
    return series


def _column_bounds(series: pd.Series) -> tuple[float, float]:
    q1 = series.quantile(0.25)
    q3 = series.quantile(0.75)
    iqr = q3 - q1
    return float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)


def clean_dataframe(
    frame: pd.DataFrame,
    drop_columns: list[str],
    fill_missing: str,
    fill_categorical: str,
    remove_duplicates: bool,
    trim_whitespace: bool,
    normalize_headers: bool,
    text_case: str,
    drop_missing_rows: bool,
    drop_empty_columns: bool,
    drop_constant_columns: bool,
    remove_outliers: bool,
    cap_outliers: bool,
    outlier_column: str | None,
    convert_column: str | None,
    convert_type: str | None,
    round_numeric: bool,
    round_digits: int,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    cleaned = frame.copy()
    rows_before = int(len(cleaned))
    columns_before = cleaned.columns.tolist()

    object_columns = cleaned.select_dtypes(include=["object", "string"]).columns.tolist()
    if trim_whitespace:
        for column in object_columns:
            cleaned[column] = cleaned[column].apply(lambda value: value.strip() if isinstance(value, str) else value)

    if object_columns:
        cleaned[object_columns] = cleaned[object_columns].replace(r"^\s*$", np.nan, regex=True)

    header_map = None
    if normalize_headers:
        old_headers = cleaned.columns.tolist()
        new_headers = _normalize_headers(old_headers)
        header_map = dict(zip(old_headers, new_headers))
        cleaned.columns = new_headers
        drop_columns = [header_map.get(column, column) for column in drop_columns]
        if outlier_column:
            outlier_column = header_map.get(outlier_column, outlier_column)
        if convert_column:
            convert_column = header_map.get(convert_column, convert_column)

    text_columns = cleaned.select_dtypes(include=["object", "string"]).columns.tolist()
    if text_case != "none":
        for column in text_columns:
            cleaned[column] = _apply_text_case(cleaned[column], text_case)

    cleaned, conversion_summary = _convert_column_type(cleaned, convert_column, convert_type)

    empty_columns_dropped = []
    if drop_empty_columns:
        empty_columns_dropped = [column for column in cleaned.columns if cleaned[column].isna().all()]
        if empty_columns_dropped:
            cleaned = cleaned.drop(columns=empty_columns_dropped)

    constant_columns_dropped = []
    if drop_constant_columns:
        constant_columns_dropped = [column for column in cleaned.columns if cleaned[column].nunique(dropna=False) <= 1]
        if constant_columns_dropped:
            cleaned = cleaned.drop(columns=constant_columns_dropped)

    existing_drop_columns = [column for column in drop_columns if column in cleaned.columns]
    if existing_drop_columns:
        cleaned = cleaned.drop(columns=existing_drop_columns)

    missing_rows_dropped = 0
    if drop_missing_rows:
        before_missing_drop = len(cleaned)
        cleaned = cleaned.dropna()
        missing_rows_dropped = before_missing_drop - len(cleaned)

    duplicates_removed = 0
    if remove_duplicates:
        before_duplicates = len(cleaned)
        cleaned = cleaned.drop_duplicates()
        duplicates_removed = before_duplicates - len(cleaned)

    numeric_columns = cleaned.select_dtypes(include=np.number).columns.tolist()
    categorical_columns = cleaned.select_dtypes(exclude=np.number).columns.tolist()

    if fill_missing == "median" and numeric_columns:
        cleaned[numeric_columns] = cleaned[numeric_columns].fillna(cleaned[numeric_columns].median())
    elif fill_missing == "mean" and numeric_columns:
        cleaned[numeric_columns] = cleaned[numeric_columns].fillna(cleaned[numeric_columns].mean())
    elif fill_missing == "zero" and numeric_columns:
        cleaned[numeric_columns] = cleaned[numeric_columns].fillna(0)
    elif fill_missing == "mode":
        for column in numeric_columns:
            mode = cleaned[column].mode(dropna=True)
            if not mode.empty:
                cleaned[column] = cleaned[column].fillna(mode.iloc[0])

    if categorical_columns:
        if fill_categorical == "mode":
            for column in categorical_columns:
                mode = cleaned[column].mode(dropna=True)
                if not mode.empty:
                    cleaned[column] = cleaned[column].fillna(mode.iloc[0])
        elif fill_categorical == "unknown":
            for column in categorical_columns:
                cleaned[column] = cleaned[column].fillna("Unknown")
        elif fill_categorical == "empty":
            for column in categorical_columns:
                cleaned[column] = cleaned[column].fillna("")

    outliers_removed = 0
    outliers_capped = 0
    if outlier_column and outlier_column in cleaned.columns and pd.api.types.is_numeric_dtype(cleaned[outlier_column]):
        lower, upper = _column_bounds(cleaned[outlier_column].dropna())
        if remove_outliers:
            before_outliers = len(cleaned)
            cleaned = cleaned[(cleaned[outlier_column] >= lower) & (cleaned[outlier_column] <= upper)]
            outliers_removed = before_outliers - len(cleaned)
        elif cap_outliers:
            before = cleaned[outlier_column].copy()
            cleaned[outlier_column] = cleaned[outlier_column].clip(lower=lower, upper=upper)
            outliers_capped = int((before != cleaned[outlier_column]).sum())

    if round_numeric:
        rounded_columns = cleaned.select_dtypes(include=np.number).columns.tolist()
        if rounded_columns:
            cleaned[rounded_columns] = cleaned[rounded_columns].round(round_digits)

    summary = {
        "rows_before": rows_before,
        "rows_after": int(len(cleaned)),
        "columns_before": columns_before,
        "columns_after": cleaned.columns.tolist(),
        "dropped_columns": existing_drop_columns,
        "empty_columns_dropped": empty_columns_dropped,
        "constant_columns_dropped": constant_columns_dropped,
        "duplicates_removed": int(duplicates_removed),
        "missing_rows_dropped": int(missing_rows_dropped),
        "missing_after": int(cleaned.isna().sum().sum()),
        "fill_missing": fill_missing,
        "fill_categorical": fill_categorical,
        "trim_whitespace": trim_whitespace,
        "normalize_headers": normalize_headers,
        "text_case": text_case,
        "header_map": header_map,
        "outlier_column": outlier_column,
        "outliers_removed": int(outliers_removed),
        "outliers_capped": int(outliers_capped),
        "round_numeric": round_numeric,
        "round_digits": round_digits,
        "conversion": conversion_summary,
    }
    return cleaned, summary


def generate_eda(frame: pd.DataFrame) -> dict[str, Any]:
    numeric = frame.select_dtypes(include=np.number)
    categorical = frame.select_dtypes(exclude=np.number)
    missing_values = frame.isna().sum().astype(int).to_dict()
    missing_percent = ((frame.isna().mean() * 100).round(2)).to_dict()
    unique_counts = frame.nunique(dropna=False).astype(int).to_dict()
    correlations = numeric.corr(numeric_only=True).fillna(0).round(3).to_dict() if not numeric.empty else {}
    strong_correlations = []
    if correlations:
        seen_pairs = set()
        for left, row in correlations.items():
            for right, value in row.items():
                if left == right:
                    continue
                pair = tuple(sorted((left, right)))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                if abs(value) >= 0.6:
                    strong_correlations.append({"pair": f"{pair[0]} vs {pair[1]}", "correlation": value})
        strong_correlations = sorted(strong_correlations, key=lambda item: abs(item["correlation"]), reverse=True)[:10]

    return {
        "shape": {"rows": int(frame.shape[0]), "columns": int(frame.shape[1])},
        "columns": frame.columns.tolist(),
        "numeric_columns": numeric.columns.tolist(),
        "categorical_columns": categorical.columns.tolist(),
        "dtypes": {column: str(dtype) for column, dtype in frame.dtypes.items()},
        "missing_values": missing_values,
        "missing_percent": missing_percent,
        "unique_counts": unique_counts,
        "duplicate_rows": int(frame.duplicated().sum()),
        "memory_usage_mb": round(float(frame.memory_usage(deep=True).sum() / (1024 * 1024)), 3),
        "describe": numeric.describe().round(3).to_dict() if not numeric.empty else {},
        "correlations": correlations,
        "strong_correlations": strong_correlations,
        "categorical_summary": {column: categorical[column].astype(str).value_counts().head(10).to_dict() for column in categorical.columns[:8]},
        "preview": frame.head(10).replace({np.nan: None}).to_dict(orient="records"),
    }


def generate_visualizations(frame: pd.DataFrame, chart_types: list[str], x_axis: str | None, y_axis: str | None, color_by: str | None) -> list[dict[str, Any]]:
    numeric_columns = frame.select_dtypes(include=np.number).columns.tolist()
    categorical_columns = frame.select_dtypes(exclude=np.number).columns.tolist()
    chosen_x = x_axis or (categorical_columns[0] if categorical_columns else frame.columns[0])
    chosen_y = y_axis or (numeric_columns[0] if numeric_columns else None)
    pie_source = chosen_x if chosen_x in frame.columns else (categorical_columns[0] if categorical_columns else None)
    charts = []
    for chart_type in chart_types:
        if chart_type == "pie" and pie_source:
            counts = frame[pie_source].astype(str).value_counts().head(8)
            charts.append({"type": "pie", "title": f"{pie_source} distribution", "labels": counts.index.tolist(), "values": counts.values.tolist(), "palette": PALETTE})
            continue
        if not chosen_y or chosen_x not in frame.columns or chosen_y not in frame.columns:
            continue
        sample_cols = [chosen_x, chosen_y] + ([color_by] if color_by and color_by in frame.columns else [])
        sample = frame[sample_cols].head(200)
        charts.append({"type": chart_type, "title": f"{chart_type.title()} of {chosen_y} by {chosen_x}", "x": sample[chosen_x].astype(str).tolist(), "y": sample[chosen_y].tolist(), "color": sample[color_by].astype(str).tolist() if color_by and color_by in sample.columns else None, "palette": PALETTE})
    return charts


def train_model(frame: pd.DataFrame, target_column: str, model_type: str, train_split: float, model_name: str) -> dict[str, Any]:
    if target_column not in frame.columns:
        raise ValueError("Selected target column does not exist")
    dataset = frame.dropna(subset=[target_column]).copy()
    X = dataset.drop(columns=[target_column])
    y = dataset[target_column]
    numeric_features = X.select_dtypes(include=np.number).columns.tolist()
    categorical_features = X.select_dtypes(exclude=np.number).columns.tolist()
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]), numeric_features),
            ("cat", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("encoder", OneHotEncoder(handle_unknown="ignore"))]), categorical_features),
        ]
    )
    is_classification = y.dtype == "object" or y.nunique() <= 12
    if model_type == "auto":
        estimator = XGBClassifier(n_estimators=120, max_depth=5, learning_rate=0.1, eval_metric="logloss") if is_classification else XGBRegressor(n_estimators=150, max_depth=5, learning_rate=0.08)
    elif model_type == "random_forest":
        estimator = RandomForestClassifier() if is_classification else RandomForestRegressor()
    else:
        estimator = LogisticRegression(max_iter=1000) if is_classification else LinearRegression()

    pipeline = Pipeline([("preprocessor", preprocessor), ("model", estimator)])
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        train_size=train_split,
        random_state=42,
        stratify=y if is_classification and y.nunique() > 1 else None,
    )
    pipeline.fit(X_train, y_train)
    predictions = pipeline.predict(X_test)

    prediction_preview = [
        {"actual": str(actual), "predicted": str(predicted)}
        for actual, predicted in list(zip(y_test.tolist(), predictions.tolist()))[:10]
    ]

    if is_classification:
        metrics = {
            "problem_type": "classification",
            "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
            "precision": round(float(precision_score(y_test, predictions, average="weighted", zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, predictions, average="weighted", zero_division=0)), 4),
            "f1_score": round(float(f1_score(y_test, predictions, average="weighted", zero_division=0)), 4),
            "classes": sorted(y.astype(str).unique().tolist()),
            "confusion_matrix": confusion_matrix(y_test, predictions).tolist(),
        }
        score = metrics["accuracy"]
    else:
        rmse = float(np.sqrt(mean_squared_error(y_test, predictions)))
        mae = float(mean_absolute_error(y_test, predictions))
        metrics = {
            "problem_type": "regression",
            "r2_score": round(float(r2_score(y_test, predictions)), 4),
            "rmse": round(rmse, 4),
            "mae": round(mae, 4),
        }
        score = metrics["r2_score"]

    model_path = MODEL_DIR / f"{model_name}.joblib"
    joblib.dump(pipeline, model_path)

    model = pipeline.named_steps["model"]
    feature_names: list[str] = []
    try:
        feature_names = pipeline.named_steps["preprocessor"].get_feature_names_out().tolist()
    except Exception:
        feature_names = numeric_features + categorical_features

    importance_values = None
    if hasattr(model, "feature_importances_"):
        importance_values = np.array(model.feature_importances_)
    elif hasattr(model, "coef_"):
        coefficients = np.array(model.coef_)
        importance_values = np.mean(np.abs(coefficients), axis=0) if coefficients.ndim > 1 else np.abs(coefficients)

    top_features = []
    if importance_values is not None and len(feature_names) == len(importance_values):
        ranking = sorted(
            [{"name": feature_names[index], "importance": round(float(value), 4)} for index, value in enumerate(importance_values)],
            key=lambda item: item["importance"],
            reverse=True,
        )
        top_features = ranking[:15]

    return {
        "target_column": target_column,
        "model_type": pipeline.named_steps["model"].__class__.__name__,
        "train_split_percentage": round(train_split * 100, 2),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "total_rows": int(len(dataset)),
        "feature_count": int(X.shape[1]),
        "numeric_feature_count": int(len(numeric_features)),
        "categorical_feature_count": int(len(categorical_features)),
        "metrics": metrics,
        "score": score,
        "model_path": str(model_path),
        "top_features": top_features,
        "prediction_preview": prediction_preview,
        "train_score": round(float(pipeline.score(X_train, y_train)), 4),
        "test_score": round(float(pipeline.score(X_test, y_test)), 4),
    }


def export_dashboard_report(payload: dict[str, Any], export_path: Path) -> Path:
    project = payload.get("project") or {}
    datasets = payload.get("datasets") or []
    cleaning = payload.get("latest_cleaning") or {}
    eda = payload.get("latest_eda") or {}
    training = payload.get("latest_training") or {}
    visuals = payload.get("latest_visualizations") or []

    dataset_rows = "".join(
        f"<tr><td>{item.get('name')}</td><td>{item.get('row_count')}</td><td>{item.get('column_count')}</td><td>{item.get('target_column') or '-'}</td></tr>"
        for item in datasets
    ) or "<tr><td colspan='4'>No datasets saved</td></tr>"
    chart_rows = "".join(
        f"<li>{chart.get('title')} ({chart.get('type')})</li>" for chart in visuals
    ) or "<li>No charts available</li>"
    html = f"""<!doctype html>
<html>
<head>
  <meta charset='utf-8' />
  <title>{project.get('name', 'Dashboard Report')}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 28px; color: #14303d; }}
    .hero {{ padding: 20px; border-radius: 18px; background: linear-gradient(135deg, #e6fff8, #eff6ff, #fff3e8); margin-bottom: 20px; }}
    .grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }}
    .card {{ border: 1px solid #d8e3ea; border-radius: 16px; padding: 16px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ border-bottom: 1px solid #e5edf2; padding: 8px; text-align: left; }}
  </style>
</head>
<body>
  <div class='hero'>
    <h1>{project.get('name', 'Data Forge Dashboard')}</h1>
    <p>{project.get('description', '')}</p>
  </div>
  <div class='grid'>
    <section class='card'>
      <h2>Datasets</h2>
      <table><thead><tr><th>Name</th><th>Rows</th><th>Columns</th><th>Target</th></tr></thead><tbody>{dataset_rows}</tbody></table>
    </section>
    <section class='card'>
      <h2>Cleaning</h2>
      <pre>{json.dumps(cleaning, indent=2)}</pre>
    </section>
    <section class='card'>
      <h2>EDA</h2>
      <pre>{json.dumps(eda, indent=2)}</pre>
    </section>
    <section class='card'>
      <h2>ML Training</h2>
      <pre>{json.dumps(training, indent=2)}</pre>
    </section>
  </div>
  <section class='card' style='margin-top: 18px;'>
    <h2>Visualizations</h2>
    <ul>{chart_rows}</ul>
  </section>
</body>
</html>"""
    export_path.write_text(html, encoding="utf-8")
    return export_path
