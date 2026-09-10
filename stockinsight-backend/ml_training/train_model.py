"""
train_model.py
==============
Train an XGBoost classifier on the dataset produced by generate_dataset.py.

Features:
  - fundamental_score (0-100)
  - technical_score   (0-100)
  - sentiment_score   (0-100)
  - vix_level         (VIX index close)
  - stock_beta        (stock beta vs market)
  - peg_ratio         (PEG ratio)
  - rsi_14            (14-day RSI)
  - sector            (categorical → one-hot)

Target:
  - label  (1 = stock up after 30 days, 0 = stock down)

Output:
  ../ml_artifacts/xgb_model.joblib   — sklearn Pipeline ready for inference

Usage:
  cd stockinsight-backend
  python -m ml_training.train_model
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
log = logging.getLogger("train_model")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TRAINING_CSV = Path(__file__).resolve().parent / "training_data.csv"
MODEL_OUTPUT = Path(__file__).resolve().parent.parent / "ml_artifacts" / "xgb_model.joblib"

# ---------------------------------------------------------------------------
# Feature / target columns
# ---------------------------------------------------------------------------
NUMERIC_FEATURES = [
    "fundamental_score",
    "technical_score",
    "sentiment_score",
    "vix_level",
    "stock_beta",
    "peg_ratio",
    "rsi_14",
]
CATEGORICAL_FEATURES = ["sector"]
ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES
TARGET = "label"


def train():
    # ── Load data ──────────────────────────────────────────────────────
    log.info("Loading training data from %s", TRAINING_CSV)
    df = pd.read_csv(TRAINING_CSV)
    log.info("Loaded %d rows, %d columns.", len(df), len(df.columns))

    if TARGET not in df.columns:
        raise ValueError(f"Target column '{TARGET}' not found in CSV.")

    # Drop rows where the target is missing
    df = df.dropna(subset=[TARGET])
    log.info("After dropping NaN targets: %d rows.", len(df))

    X = df[ALL_FEATURES].copy()
    y = df[TARGET].astype(int)

    log.info("Label distribution:\n%s", y.value_counts().to_string())
    log.info("Feature NaN counts:\n%s", X.isna().sum().to_string())

    # ── Compute scale_pos_weight for class imbalance ───────────────────
    n_neg = int((y == 0).sum())
    n_pos = int((y == 1).sum())
    scale_pos_weight = n_neg / n_pos if n_pos > 0 else 1.0
    log.info("Class balance: neg=%d, pos=%d, scale_pos_weight=%.2f", n_neg, n_pos, scale_pos_weight)

    # ── Build pipeline ─────────────────────────────────────────────────
    numeric_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])

    categorical_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="constant", fill_value="Unknown")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])

    preprocessor = ColumnTransformer(transformers=[
        ("num", numeric_transformer, NUMERIC_FEATURES),
        ("cat", categorical_transformer, CATEGORICAL_FEATURES),
    ])

    model = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("classifier", XGBClassifier(
            n_estimators=500,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=5,
            gamma=1,
            reg_alpha=0.1,
            reg_lambda=1.0,
            scale_pos_weight=scale_pos_weight,
            eval_metric="logloss",
            random_state=42,
            n_jobs=-1,
            verbosity=0,
        )),
    ])

    # ── Cross-validation ───────────────────────────────────────────────
    log.info("Running 5-fold stratified cross-validation...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    # Predict probabilities OOF for ROC-AUC
    y_proba_oof = cross_val_predict(model, X, y, cv=cv, method="predict_proba")[:, 1]
    y_pred_oof = (y_proba_oof >= 0.5).astype(int)

    acc = accuracy_score(y, y_pred_oof)
    try:
        auc = roc_auc_score(y, y_proba_oof)
    except ValueError:
        auc = float("nan")

    log.info("=== Cross-Validation Results ===")
    log.info("Accuracy : %.4f", acc)
    log.info("ROC-AUC  : %.4f", auc)
    log.info("Classification report:\n%s", classification_report(y, y_pred_oof))

    # ── Train final model on all data ──────────────────────────────────
    log.info("Training final model on all %d samples...", len(X))
    model.fit(X, y)

    # Feature importances (after one-hot expansion)
    clf = model.named_steps["classifier"]
    ohe_features = []
    try:
        ohe = model.named_steps["preprocessor"].named_transformers_["cat"].named_steps["onehot"]
        ohe_features = list(ohe.get_feature_names_out(CATEGORICAL_FEATURES))
    except Exception:
        n_cat = clf.n_features_in_ - len(NUMERIC_FEATURES)
        ohe_features = [f"sector_{i}" for i in range(n_cat)]

    feature_names = NUMERIC_FEATURES + ohe_features
    importances = clf.feature_importances_
    log.info("Feature importances:")
    for name, imp in sorted(zip(feature_names, importances), key=lambda x: -x[1]):
        if imp > 0.005:
            log.info("  %-35s  %.4f", name, imp)

    # ── Save model ─────────────────────────────────────────────────────
    MODEL_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_OUTPUT)
    log.info("Model saved to %s", MODEL_OUTPUT)

    # Quick sanity check: load and predict
    loaded = joblib.load(MODEL_OUTPUT)
    sample = X.head(5)
    proba = loaded.predict_proba(sample)[:, 1]
    log.info("Sanity check — first 5 predictions (prob of UP): %s", np.round(proba, 3))

    log.info("=== Training complete ===")


if __name__ == "__main__":
    train()
