from contextlib import asynccontextmanager
import json
import math
import base64
import binascii
import re
import sqlite3
from typing import Any
import cv2
import numpy as np

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from .db import connect, initialize


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize()
    yield


app = FastAPI(title="Patronaje Pro", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


class PatternInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    geometry: dict[str, Any]
    product_id: int | None = None
    code: str | None = Field(default=None, max_length=40)
    garment_type: str | None = Field(default=None, max_length=60)
    pattern_kind: str | None = Field(default=None, pattern="^(base|variant)$")
    family_id: int | None = None
    variant_of_id: int | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre no puede estar vacío")
        return value


class ProductInput(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=2000)
    reference_image: str | None = None
    status: str = Field(default="draft", pattern="^(draft|active|archived)$")
    notes: str = Field(default="", max_length=2000)

    @field_validator("code", "name", "category")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def nonempty_required(self):
        if not self.code or not self.name:
            raise ValueError("El código y el nombre son obligatorios")
        return self

    @field_validator("reference_image")
    @classmethod
    def valid_reference_image(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        match = re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})", value)
        if not match:
            raise ValueError("Usa una imagen PNG, JPG o WebP")
        try:
            content = base64.b64decode(match.group(1), validate=True)
        except binascii.Error as error:
            raise ValueError("La imagen no tiene un formato válido") from error
        if len(content) > 4_000_000:
            raise ValueError("La imagen no puede superar 4 MB")
        mime = value[5:value.index(";")]
        valid = content.startswith(b"\x89PNG\r\n\x1a\n") if mime == "image/png" else content.startswith(b"\xff\xd8\xff") if mime == "image/jpeg" else len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"
        if not valid:
            raise ValueError("El contenido no coincide con el formato de imagen")
        return value


class SizeInput(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    sort_order: int = 0

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        return value.strip()


class MeasurementInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    tolerance_cm: float | None = Field(default=None, ge=0, le=100)

    @field_validator("name")
    @classmethod
    def trim_measurement_name(cls, value: str) -> str:
        return value.strip()


class MeasurementValuesInput(BaseModel):
    values: dict[int, float | None]

    @field_validator("values")
    @classmethod
    def valid_measurements(cls, values: dict[int, float | None]) -> dict[int, float | None]:
        if any(value is not None and (not math.isfinite(value) or value < 0 or value > 100_000) for value in values.values()):
            raise ValueError("Las medidas deben estar entre 0 y 100.000 cm")
        return values


class ScalingRuleInput(BaseModel):
    measurement_id: int
    from_size_id: int
    to_size_id: int
    increment_cm: float

    @field_validator("increment_cm")
    @classmethod
    def valid_increment(cls, value: float) -> float:
        if not math.isfinite(value) or abs(value) > 100_000:
            raise ValueError("El incremento debe ser una medida válida en centímetros")
        return value


class MaterialInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: str = Field(min_length=1, max_length=50)
    color: str = Field(default="", max_length=60)
    composition: str = Field(default="", max_length=200)
    width_mm: float | None = Field(default=None, gt=0, le=100_000)
    supplier: str = Field(default="", max_length=100)
    unit: str = Field(default="m", max_length=20)
    unit_price: float | None = Field(default=None, ge=0)
    notes: str = Field(default="", max_length=1000)

    @field_validator("name", "kind", "color", "composition", "supplier", "unit")
    @classmethod
    def trim_material_text(cls, value: str) -> str:
        return value.strip()


class ProductMaterialInput(BaseModel):
    material_id: int
    quantity: float | None = Field(default=None, ge=0)
    quantity_kind: str = Field(default="manual", pattern="^(manual|estimated)$")
    notes: str = Field(default="", max_length=500)


class EstimateInput(BaseModel):
    wastage_percent: float = Field(default=0, ge=0, le=100)


class SheetInput(BaseModel):
    content: dict[str, Any]


class SheetTemplateInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    content: dict[str, Any]

    @field_validator("name")
    @classmethod
    def clean_template_name(cls, value: str) -> str:
        value=value.strip()
        if not value:
            raise ValueError("Escribe un nombre para la plantilla")
        return value


class PhotoTraceInput(BaseModel):
    image_data: str = Field(min_length=50, max_length=7_000_000)
    method: str = Field(default="hybrid", pattern="^(hybrid|adaptive|global|edges)$")
    threshold: int = Field(default=155, ge=30, le=240)
    sensitivity: int = Field(default=2, ge=1, le=3)
    min_area: int = Field(default=1200, ge=100, le=100_000)
    brightness: int = Field(default=0, ge=-80, le=80)
    contrast: float = Field(default=1, ge=0.5, le=1.8)
    remove_shadows: bool = True
    sharpen: bool = True

    @field_validator("image_data")
    @classmethod
    def valid_image_data(cls, value: str) -> str:
        if not re.fullmatch(r"data:image/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("La extracción admite imágenes PNG o JPG válidas")
        return value


class PhotoRectifyInput(BaseModel):
    image_data: str = Field(min_length=50, max_length=7_000_000)
    corners: list[list[float]] = Field(min_length=4, max_length=4)

    @field_validator("image_data")
    @classmethod
    def valid_rectify_image(cls, value: str) -> str:
        if not re.fullmatch(r"data:image/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("La rectificación admite imágenes PNG o JPG válidas")
        return value

    @field_validator("corners")
    @classmethod
    def valid_corners(cls, value: list[list[float]]) -> list[list[float]]:
        if any(len(point) != 2 or any(not math.isfinite(coordinate) for coordinate in point) for point in value):
            raise ValueError("Marca cuatro esquinas válidas")
        return value


class PhotoAlignInput(BaseModel):
    reference_image: str = Field(min_length=50, max_length=7_000_000)
    moving_image: str = Field(min_length=50, max_length=7_000_000)
    reference_mm_per_px: float = Field(gt=0, le=100)
    moving_mm_per_px: float = Field(gt=0, le=100)

    @field_validator("reference_image", "moving_image")
    @classmethod
    def valid_alignment_image(cls, value: str) -> str:
        if not re.fullmatch(r"data:image/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("El alineamiento admite imágenes PNG o JPG válidas")
        return value

def serialize_geometry(geometry: dict[str, Any]) -> str:
    if geometry.get("unit") != "mm" or not isinstance(geometry.get("items"), list):
        raise HTTPException(status_code=422, detail="La geometría debe indicar unidad mm y una lista de elementos")
    items = geometry["items"]
    if len(items) > 10_000:
        raise HTTPException(status_code=422, detail="El molde excede el máximo de 10.000 elementos")
    for item in items:
        if not isinstance(item, dict) or item.get("type") not in {"point", "line", "curve", "piece"}:
            raise HTTPException(status_code=422, detail="El molde contiene un tipo de elemento no válido")
        keys = ["x", "y"] if item["type"] == "point" else ["x", "y", "x2", "y2"] if item["type"] == "line" else ["x", "y", "cx", "cy", "x2", "y2"] if item["type"] == "curve" else []
        values = [item.get(key) for key in keys]
        if item["type"] == "piece":
            vertices = item.get("vertices")
            if not isinstance(vertices, list) or len(vertices) < 3:
                raise HTTPException(status_code=422, detail="Cada contorno debe tener al menos 3 vértices")
            values = [coordinate for point in vertices if isinstance(point, dict) for coordinate in (point.get("x"), point.get("y"))]
            if len(values) != 2 * len(vertices):
                raise HTTPException(status_code=422, detail="El contorno contiene coordenadas no válidas")
        if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in values):
            raise HTTPException(status_code=422, detail="Las coordenadas deben ser números finitos")
        if item["type"] == "line" and item.get("markType") not in (None, "dart", "notch", "fold", "internal"):
            raise HTTPException(status_code=422, detail="El tipo de marca no es válido")
        if item["type"] == "piece" and (not isinstance(item.get("seamAllowanceMm", 0), (int, float)) or not math.isfinite(item.get("seamAllowanceMm", 0)) or not 0 <= item.get("seamAllowanceMm", 0) <= 500):
            raise HTTPException(status_code=422, detail="El margen de costura debe estar entre 0 y 50 cm")
        if item.get("label") is not None and (not isinstance(item["label"], str) or len(item["label"]) > 100):
            raise HTTPException(status_code=422, detail="La anotación no puede superar 100 caracteres")
    references = geometry.get("reference_images", [])
    if not isinstance(references, list) or len(references) > 12:
        raise HTTPException(status_code=422, detail="El molde admite hasta 12 fotografías de referencia")
    if any(key in geometry and not isinstance(geometry[key], bool) for key in ("photo_derived", "photo_scale_calibrated")):
        raise HTTPException(status_code=422, detail="El estado de calibración del molde no es válido")
    for image in references:
        if not isinstance(image, dict) or not isinstance(image.get("data"), str) or not re.fullmatch(r"data:image/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}", image["data"]):
            raise HTTPException(status_code=422, detail="La referencia debe ser una imagen PNG o JPEG válida")
        if not isinstance(image.get("name"), str) or len(image["name"]) > 200 or not isinstance(image.get("calibrated"), bool) or not isinstance(image.get("opacity"), (int, float)) or not 0.1 <= image["opacity"] <= 1:
            raise HTTPException(status_code=422, detail="Los datos de la fotografía de referencia no son válidos")
        if not all(isinstance(image.get(key), (int, float)) and math.isfinite(image[key]) for key in ("width", "height", "x", "y", "scale")) or image["width"] <= 0 or image["height"] <= 0 or image["scale"] <= 0:
            raise HTTPException(status_code=422, detail="La referencia contiene medidas inválidas")
        try:
            binary = base64.b64decode(image["data"].split(",", 1)[1], validate=True)
        except (binascii.Error, ValueError) as error:
            raise HTTPException(status_code=422, detail="La imagen de referencia no tiene datos válidos") from error
        if len(binary) > 3_200_000 or (image["data"].startswith("data:image/png") and not binary.startswith(b"\x89PNG\r\n\x1a\n")) or (image["data"].startswith("data:image/jpeg") and not binary.startswith(b"\xff\xd8\xff")):
            raise HTTPException(status_code=422, detail="La fotografía debe ser PNG/JPG válida y no superar 3,2 MB")
        original = image.get("original_data")
        if original is not None:
            if not isinstance(original, str) or not re.fullmatch(r"data:image/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}", original):
                raise HTTPException(status_code=422, detail="La fotografía original no es válida")
            try:
                original_bytes = base64.b64decode(original.split(",", 1)[1], validate=True)
            except (binascii.Error, ValueError) as error:
                raise HTTPException(status_code=422, detail="La fotografía original no es válida") from error
            if len(original_bytes) > 3_200_000:
                raise HTTPException(status_code=422, detail="La foto original no puede superar 3,2 MB")
        processed = image.get("processed_data")
        if processed is not None:
            if not isinstance(processed, str) or not re.fullmatch(r"data:image/png;base64,[A-Za-z0-9+/]+={0,2}", processed):
                raise HTTPException(status_code=422, detail="La capa procesada debe ser una imagen PNG válida")
            try:
                processed_bytes = base64.b64decode(processed.split(",", 1)[1], validate=True)
            except (binascii.Error, ValueError) as error:
                raise HTTPException(status_code=422, detail="La capa procesada no es válida") from error
            if len(processed_bytes) > 3_200_000 or not processed_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                raise HTTPException(status_code=422, detail="La capa procesada supera el límite o no es PNG válida")
    encoded = json.dumps(geometry, separators=(",", ":"), allow_nan=False)
    if len(encoded) > 10_000_000:
        raise HTTPException(status_code=413, detail="El molde y sus fotos superan el límite de 10 MB")
    return encoded


def skeletonize(binary: np.ndarray) -> np.ndarray:
    image = binary.copy()
    skeleton = np.zeros_like(image)
    kernel = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    for _ in range(120):
        eroded = cv2.erode(image, kernel)
        opened = cv2.dilate(eroded, kernel)
        skeleton = cv2.bitwise_or(skeleton, cv2.subtract(image, opened))
        image = eroded
        if cv2.countNonZero(image) == 0:
            break
    return skeleton


def order_quad(points: np.ndarray) -> np.ndarray:
    points = points.astype(np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).ravel()
    return np.array([points[np.argmin(sums)], points[np.argmin(diffs)], points[np.argmax(sums)], points[np.argmax(diffs)]], dtype=np.float32)


def detect_paper_quad(gray: np.ndarray, color: np.ndarray) -> tuple[np.ndarray | None, float]:
    """Return a conservative page-boundary proposal; never treat it as pattern geometry."""
    height, width = gray.shape
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 35, 110)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if not width * height * 0.12 <= area <= width * height * 0.94:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.025 * perimeter, True).reshape(-1, 2)
        if len(approx) != 4 or not cv2.isContourConvex(approx.reshape(-1, 1, 2)):
            continue
        quad = order_quad(approx)
        inside = np.zeros((height, width), np.uint8)
        cv2.fillConvexPoly(inside, quad.astype(np.int32), 255)
        mean_light = cv2.mean(gray, mask=inside)[0] / 255
        mean_sat = cv2.mean(cv2.cvtColor(color, cv2.COLOR_BGR2HSV)[:, :, 1], mask=inside)[0] / 255
        area_ratio = area / (width * height)
        # A large, bright, low-chroma quadrilateral is more likely a sheet than a pattern stroke.
        score = min(1.0, 0.35 * mean_light + 0.35 * (1 - mean_sat) + 0.3 * min(area_ratio / 0.45, 1))
        if mean_light > 0.55 and mean_sat < 0.35:
            candidates.append((score, quad, area_ratio))
    if not candidates:
        return None, 0.0
    score, quad, _ = max(candidates, key=lambda entry: entry[0])
    return quad, round(score, 3)


@app.post("/api/photos/extract")
def extract_photo_geometry(data: PhotoTraceInput):
    try:
        encoded = base64.b64decode(data.image_data.split(",", 1)[1], validate=True)
        color_source = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (binascii.Error, ValueError, cv2.error) as error:
        raise HTTPException(status_code=422, detail="No se pudo leer la fotografía") from error
    if color_source is None or color_source.size == 0:
        raise HTTPException(status_code=422, detail="No se pudo leer la fotografía")
    original_height, original_width = color_source.shape[:2]
    if original_width * original_height > 40_000_000:
        raise HTTPException(status_code=413, detail="La fotografía supera el límite de 40 megapíxeles")
    factor = min(1.0, 1800 / max(original_width, original_height))
    if factor < 1:
        color_source = cv2.resize(color_source, (round(original_width * factor), round(original_height * factor)), interpolation=cv2.INTER_AREA)
    source = cv2.cvtColor(color_source, cv2.COLOR_BGR2GRAY)
    height, width = source.shape
    sensitivity = data.sensitivity
    denoised = cv2.bilateralFilter(source, 5 + 2 * (sensitivity % 2), 35, 35)
    adjusted = np.clip((denoised.astype(np.float32)-127.5)*data.contrast+127.5+data.brightness,0,255).astype(np.uint8)
    if data.remove_shadows:
        # Smooth background normalization handles broad illumination gradients without
        # replacing the stored source photo or changing the pixel coordinate system.
        kernel_size=max(31,min(151,(min(width,height)//10)|1))
        background=cv2.GaussianBlur(adjusted,(kernel_size,kernel_size),0)
        adjusted=cv2.divide(adjusted,cv2.max(background,np.full_like(background,32)),scale=220)
    if data.sharpen:
        adjusted=cv2.addWeighted(adjusted,1.35,cv2.GaussianBlur(adjusted,(0,0),1.2),-0.35,0)
    equalized = cv2.createCLAHE(clipLimit=1.5 + 0.4 * sensitivity, tileGridSize=(8, 8)).apply(adjusted)
    if data.method == "edges":
        low = 35 + (3 - sensitivity) * 12
        binary = cv2.Canny(equalized, low, low * 2.6)
    elif data.method == "global":
        _, binary = cv2.threshold(equalized, data.threshold, 255, cv2.THRESH_BINARY_INV)
    else:
        block = min(41, min(width, height) // 2 * 2 - 1)
        block = max(15, block if block % 2 else block - 1)
        c_value = max(2, min(16, 5 + sensitivity * 2))
        binary = cv2.adaptiveThreshold(equalized, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, c_value)
    if data.method == "hybrid":
        # Combine adaptive local contrast with strong global ink pixels.  The
        # intersection suppresses texture noise; a thin adaptive branch keeps faint strokes.
        _, global_ink = cv2.threshold(equalized, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        strong = cv2.bitwise_and(binary, global_ink)
        binary = cv2.bitwise_or(strong, cv2.erode(binary, np.ones((2, 2), np.uint8)))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    paper_quad, paper_score = detect_paper_quad(source, color_source)
    if paper_quad is not None and paper_score >= 0.68:
        paper_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillConvexPoly(paper_mask, paper_quad.astype(np.int32), 255)
        paper_mask = cv2.erode(paper_mask, np.ones((9, 9), np.uint8))
        binary = cv2.bitwise_and(binary, paper_mask)
    thin = skeletonize(binary)
    contour_image=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)))
    contours, _ = cv2.findContours(contour_image.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = data.min_area * factor * factor
    candidates: list[dict[str, Any]] = []
    accepted_bounds: list[tuple[int, int, int, int, float]] = []
    piece_contours: list[np.ndarray] = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        perimeter = cv2.arcLength(contour, True)
        area = cv2.contourArea(contour)
        points = contour.reshape(-1, 2)
        if len(points) < 8 or area < min_area or area > width * height * 0.72 or perimeter < 80 * factor:
            continue
        epsilon = max(1.0, perimeter * (0.009 - 0.002 * (sensitivity - 1)))
        approx = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(approx) < 3 or len(approx) > 250:
            continue
        # If a contour closely matches the page itself, expose it as a page proposal,
        # never as a garment-piece polygon.
        if paper_quad is not None and area > width * height * 0.16:
            overlap = cv2.intersectConvexConvex(cv2.convexHull(approx.astype(np.float32)), paper_quad)[0]
            if overlap / max(1.0, cv2.contourArea(paper_quad.astype(np.float32))) > 0.76:
                continue
        x, y, bound_width, bound_height = cv2.boundingRect(contour)
        duplicate = False
        for old_x, old_y, old_width, old_height, old_area in accepted_bounds:
            intersection = max(0, min(x+bound_width, old_x+old_width)-max(x,old_x)) * max(0,min(y+bound_height,old_y+old_height)-max(y,old_y))
            smaller = min(bound_width*bound_height, old_width*old_height)
            if smaller and intersection/smaller > 0.88 and min(area,old_area)/max(area,old_area) > 0.65:
                duplicate=True;break
        if duplicate:
            continue
        accepted_bounds.append((x,y,bound_width,bound_height,area))
        piece_contours.append(contour)
        candidates.append({"kind": "piece", "points": [[round(float(x / factor), 2), round(float(y / factor), 2)] for x, y in approx], "area_px": round(area / factor**2), "closed": True})
        raw=contour.reshape(-1,2)
        for edge,start_point in enumerate(approx):
            end_point=approx[(edge+1)%len(approx)]
            start_index=int(np.argmin(np.sum((raw-start_point)**2,axis=1)));end_index=int(np.argmin(np.sum((raw-end_point)**2,axis=1)))
            segment=raw[start_index:end_index+1] if end_index>=start_index else np.concatenate((raw[start_index:],raw[:end_index+1]))
            if len(segment)<7:continue
            middle=segment[len(segment)//2].astype(float);a=start_point.astype(float);b=end_point.astype(float);vector=b-a
            deviation=abs(vector[0]*(a[1]-middle[1])-(a[0]-middle[0])*vector[1])/(np.linalg.norm(vector)+1e-6)
            if deviation<max(2.5,min(width,height)*0.003):continue
            control=2*middle-0.5*(a+b)
            candidates.append({"kind":"curve","points":[[round(float(value/factor),2) for value in point] for point in (a,control,b)],"length_px":round(float(cv2.arcLength(segment.reshape(-1,1,2).astype(np.int32),False)/factor))})
            if sum(candidate["kind"]=="curve" for candidate in candidates)>=100:break
        if not any(candidate.get("kind")=="curve" for candidate in candidates[-len(approx)-1:]):
            window=max(12,len(raw)//12);step=max(8,window//2)
            for start_index in range(0,len(raw),step):
                end_index=(start_index+window)%len(raw)
                segment=raw[start_index:end_index+1] if end_index>=start_index else np.concatenate((raw[start_index:],raw[:end_index+1]))
                if len(segment)<8:continue
                a=segment[0].astype(float);b=segment[-1].astype(float);middle=segment[len(segment)//2].astype(float);vector=b-a
                deviation=abs(vector[0]*(a[1]-middle[1])-(a[0]-middle[0])*vector[1])/(np.linalg.norm(vector)+1e-6)
                if deviation<max(4,min(width,height)*0.005):continue
                control=2*middle-0.5*(a+b)
                candidates.append({"kind":"curve","points":[[round(float(value/factor),2) for value in point] for point in (a,control,b)],"length_px":round(float(cv2.arcLength(segment.reshape(-1,1,2).astype(np.int32),False)/factor))})
                if sum(candidate["kind"]=="curve" for candidate in candidates)>=100:break
        if len(candidates) >= 80:
            break
    min_line_length = max(30 * factor, min(width, height) * 0.035)
    lines = cv2.HoughLinesP(thin, 1, np.pi / 180, threshold=max(22, 36 - sensitivity * 5), minLineLength=min_line_length, maxLineGap=max(5, 8 - sensitivity))
    line_segments = list(lines.reshape(-1, 4)) if lines is not None else []
    if data.method == "hybrid" and hasattr(cv2, "createLineSegmentDetector"):
        lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
        detected = lsd.detect(thin)[0]
        if detected is not None:
            line_segments.extend(segment.reshape(4) for segment in detected)
    if line_segments:
        ranked = sorted(line_segments, key=lambda line: math.hypot(float(line[2]-line[0]), float(line[3]-line[1])), reverse=True)
        accepted_lines: list[np.ndarray] = []
        for line in ranked:
            x1, y1, x2, y2 = (float(value) for value in line)
            length = math.hypot(x2-x1, y2-y1)
            if length < min_line_length:
                continue
            duplicate = False
            for prior in accepted_lines:
                prior_vector = prior[2:4] - prior[0:2]
                prior_length = float(np.linalg.norm(prior_vector))
                unit = prior_vector / max(prior_length, 1e-6)
                current_vector = np.array([x2-x1, y2-y1])
                parallel = abs(float(np.dot(unit, current_vector / max(length, 1e-6)))) > math.cos(math.radians(5))
                midpoint_offset = np.array([(x1+x2-prior[0]-prior[2])/2, (y1+y2-prior[1]-prior[3])/2])
                perpendicular = abs(float(unit[0] * midpoint_offset[1] - unit[1] * midpoint_offset[0]))
                projections = sorted([float(np.dot(np.array([x1,y1])-prior[:2],unit)), float(np.dot(np.array([x2,y2])-prior[:2],unit))])
                overlap = max(0.0, min(prior_length, projections[1]) - max(0.0, projections[0]))
                if parallel and perpendicular <= max(3.0, min(width,height)*0.004) and overlap / max(1.0, min(length,prior_length)) > 0.5:
                    duplicate = True
                    break
            if duplicate:
                continue
            accepted_lines.append(np.asarray([x1, y1, x2, y2]))
            px1, py1, px2, py2 = (float(value) for value in line)
            midpoint=(px1+px2)/2,(py1+py2)/2
            distances=[cv2.pointPolygonTest(contour,midpoint,True) for contour in piece_contours]
            tolerance=max(3,min(width,height)*0.004)
            role="outline" if distances and min(abs(value) for value in distances)<=tolerance else "interior" if any(value>0 for value in distances) else "external"
            x1, y1, x2, y2 = (value / factor for value in (px1,py1,px2,py2))
            candidates.append({"kind": "line", "role": role, "points": [[round(x1, 2), round(y1, 2)], [round(x2, 2), round(y2, 2)]], "length_px": round(math.hypot(x2-x1, y2-y1))})
            if sum(candidate["kind"] == "line" for candidate in candidates) >= 100 or len(candidates) >= 180:
                break
    corners = cv2.goodFeaturesToTrack(equalized, maxCorners=60, qualityLevel=0.04, minDistance=max(10, round(min(width, height)*0.018)), blockSize=5)
    if corners is not None:
        accepted_corners = 0
        for corner in corners:
            reduced_x, reduced_y = (int(round(value)) for value in corner.ravel())
            patch = binary[max(0, reduced_y-4):min(height, reduced_y+5), max(0, reduced_x-4):min(width, reduced_x+5)]
            if cv2.countNonZero(patch) < 2:
                continue
            x, y = reduced_x / factor, reduced_y / factor
            candidates.append({"kind": "point", "points": [[round(x, 2), round(y, 2)]]})
            accepted_corners += 1
            if accepted_corners >= 24:
                break
    mask = np.zeros((height, width, 4), dtype=np.uint8)
    mask[binary > 0] = (22, 24, 30, 235)
    _, png = cv2.imencode(".png", mask)
    preview = "data:image/png;base64," + base64.b64encode(png.tobytes()).decode("ascii")
    warnings = ["Los vectores son candidatos geométricos, no reconocimiento semántico. Revisa todos los contornos y confirma manualmente piquetes, pinzas, dobleces y márgenes."]
    if paper_quad is not None:
        warnings.append("Se detectó un posible borde de papel. La perspectiva no se corrigió automáticamente; marca sus cuatro esquinas en el editor y vuelve a calibrar.")
    if min(original_width, original_height) < 700:
        warnings.append("La fotografía tiene poca resolución; revisa los candidatos con cuidado.")
    if not any(candidate["kind"] == "piece" for candidate in candidates):
        warnings.append("No se encontró un contorno cerrado claro. No se inventaron piezas; puedes ajustar la imagen o calcarla manualmente.")
    if not candidates:
        warnings.append("No se detectaron líneas con estos ajustes. Prueba otro método o mejora contraste/iluminación.")
    if cv2.countNonZero(binary)>width*height*0.22:
        warnings.append("La imagen tiene muchas zonas detectadas; objetos, sombras o texto pueden confundirse con el molde.")
    if max(original_width,original_height)>1800:
        warnings.append("La extracción se hizo a una copia reducida para procesar; las coordenadas se proyectaron a la resolución original.")
    paper_corners = [[round(float(x / factor), 2), round(float(y / factor), 2)] for x, y in paper_quad] if paper_quad is not None else None
    return {"width": original_width, "height": original_height, "processed_preview": preview, "candidates": candidates[:220], "warnings": warnings, "method": data.method, "paper_corners": paper_corners, "paper_boundary_score": paper_score, "coordinates": "original_image_pixels", "semantic_detection": False}


@app.post("/api/photos/rectify")
def rectify_photo(data: PhotoRectifyInput):
    try:
        encoded = base64.b64decode(data.image_data.split(",", 1)[1], validate=True)
        image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (binascii.Error, ValueError, cv2.error) as error:
        raise HTTPException(status_code=422, detail="No se pudo leer la fotografía") from error
    if image is None:
        raise HTTPException(status_code=422, detail="No se pudo leer la fotografía")
    height, width = image.shape[:2]
    source = order_quad(np.asarray(data.corners, dtype=np.float32))
    if np.any(source[:, 0] < 0) or np.any(source[:, 0] >= width) or np.any(source[:, 1] < 0) or np.any(source[:, 1] >= height):
        raise HTTPException(status_code=422, detail="Las esquinas deben estar dentro de la fotografía")
    top = np.linalg.norm(source[1] - source[0]); bottom = np.linalg.norm(source[2] - source[3])
    left = np.linalg.norm(source[3] - source[0]); right = np.linalg.norm(source[2] - source[1])
    out_width, out_height = int(round(max(top, bottom))), int(round(max(left, right)))
    if out_width < 50 or out_height < 50 or out_width * out_height > 40_000_000:
        raise HTTPException(status_code=422, detail="El área de rectificación no tiene un tamaño válido")
    destination = np.array([[0, 0], [out_width - 1, 0], [out_width - 1, out_height - 1], [0, out_height - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(source, destination)
    corrected = cv2.warpPerspective(image, matrix, (out_width, out_height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    ok, buffer = cv2.imencode(".jpg", corrected, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise HTTPException(status_code=500, detail="No se pudo crear la imagen rectificada")
    return {"width": out_width, "height": out_height, "image_data": "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii"), "recalibration_required": True}


@app.post("/api/photos/align")
def align_photo(data: PhotoAlignInput):
    def decode(value: str):
        raw = base64.b64decode(value.split(",", 1)[1], validate=True)
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if image is None or image.size == 0:
            raise ValueError("No se pudo leer una de las fotografías")
        factor = min(1.0, 1400 / max(image.shape))
        reduced = cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA) if factor < 1 else image
        return image, reduced, factor

    try:
        reference, ref_small, ref_factor = decode(data.reference_image)
        moving, mov_small, mov_factor = decode(data.moving_image)
    except (binascii.Error, ValueError, cv2.error) as error:
        raise HTTPException(status_code=422, detail=str(error) or "No se pudieron leer las fotografías") from error
    detector = cv2.ORB_create(nfeatures=3000, scaleFactor=1.2, nlevels=8, edgeThreshold=15, fastThreshold=8)
    ref_points, ref_desc = detector.detectAndCompute(ref_small, None)
    mov_points, mov_desc = detector.detectAndCompute(mov_small, None)
    if ref_desc is None or mov_desc is None:
        raise HTTPException(status_code=422, detail="No hay suficientes detalles compartidos; prueba con más solapamiento y textura visible")
    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(mov_desc, ref_desc, k=2)
    good = [first for first, second in matches if first.distance < 0.72 * second.distance]
    if len(good) < 12:
        raise HTTPException(status_code=422, detail="Solo se encontraron pocos puntos en común. Aumenta el solapamiento o usa alineación manual")
    source = np.float32([mov_points[item.queryIdx].pt for item in good]).reshape(-1, 1, 2)
    target = np.float32([ref_points[item.trainIdx].pt for item in good]).reshape(-1, 1, 2)
    homography, inlier_mask = cv2.findHomography(source, target, cv2.RANSAC, 3.0)
    inliers = int(inlier_mask.sum()) if inlier_mask is not None else 0
    if homography is None or inliers < 10 or inliers / len(good) < 0.3:
        raise HTTPException(status_code=422, detail="Las correspondencias no son estables. Revisa perspectiva y solapamiento manualmente")
    mh, mw = mov_small.shape
    samples = np.array([[[mw / 2, mh / 2]], [[mw / 2 + 40, mh / 2]], [[mw / 2, mh / 2 + 40]]], dtype=np.float32)
    projected = cv2.perspectiveTransform(samples, homography).reshape(-1, 2)
    mapped_center = projected[0]
    vx, vy = (projected[1] - mapped_center) / 40, (projected[2] - mapped_center) / 40
    scale = (np.linalg.norm(vx) + np.linalg.norm(vy)) / 2
    expected_scale = data.moving_mm_per_px / data.reference_mm_per_px
    if scale < 0.35 or scale > 2.8 or abs(scale - expected_scale) / expected_scale > 0.15 or abs(np.linalg.norm(vx) - np.linalg.norm(vy)) > 0.08 * expected_scale:
        raise HTTPException(status_code=422, detail="Las fotos tienen escalas o deformación muy distintas; rectifica y calibra cada sección antes de alinearlas")
    angle = math.degrees(math.atan2(float(vx[1]), float(vx[0])))
    mov_corners = np.array([[[0, 0], [mw - 1, 0], [mw - 1, mh - 1], [0, mh - 1]]], dtype=np.float32)
    actual = cv2.perspectiveTransform(mov_corners, homography).reshape(-1, 2)
    rotation = math.radians(angle)
    linear = np.array([[math.cos(rotation), -math.sin(rotation)], [math.sin(rotation), math.cos(rotation)]]) * scale
    predicted = (mov_corners.reshape(-1, 2) - np.array([mw / 2, mh / 2])) @ linear.T + mapped_center
    residual = float(np.sqrt(np.mean(np.sum((actual - predicted) ** 2, axis=1))))
    if residual > 0.035 * math.hypot(mw, mh):
        raise HTTPException(status_code=422, detail="La perspectiva entre tomas no es una rotación/traslación simple. Rectifica las fotos por separado y vuelve a calibrar")
    original_center = np.array([[[moving.shape[1] / 2, moving.shape[0] / 2]]], dtype=np.float32)
    original_center_small = original_center * mov_factor
    mapped_original = cv2.perspectiveTransform(original_center_small, homography).reshape(2) / ref_factor
    return {"center_in_reference_px": [round(float(mapped_original[0]), 2), round(float(mapped_original[1]), 2)], "rotation_deg": round(angle, 3), "relative_scale": round(float(scale), 4), "inliers": inliers, "matches": len(good), "confidence": round(inliers / len(good), 3), "translation_only": False, "review_required": True}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/overview")
def overview():
    with connect() as db:
        products = db.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        patterns = db.execute("SELECT COUNT(*) FROM patterns").fetchone()[0]
        construction = db.execute("SELECT COUNT(*) FROM technical_sheets WHERE kind = 'construction'").fetchone()[0]
        measurement = db.execute("SELECT COUNT(*) FROM technical_sheets WHERE kind = 'measurement'").fetchone()[0]
        recent = db.execute(
            """SELECT p.id, p.code, p.name, COALESCE(c.name, 'Sin categoría') AS category, p.updated_at
               FROM products p LEFT JOIN categories c ON c.id = p.category_id
               ORDER BY p.updated_at DESC LIMIT 6"""
        ).fetchall()
    return {
        "products": products,
        "patterns": patterns,
        "technical_sheets": construction,
        "measurement_sheets": measurement,
        "recent_products": [dict(row) for row in recent],
    }


def pattern_dict(row):
    keys = row.keys()
    geometry = json.loads(row["geometry_json"])
    return {"id": row["id"], "name": row["name"], "geometry": geometry, "updated_at": row["updated_at"], "created_at": row["created_at"], "product_id": row["product_id"], "code": row["code"] if "code" in keys else "", "garment_type": row["garment_type"] if "garment_type" in keys else "", "pattern_kind": row["pattern_kind"] if "pattern_kind" in keys else "base", "family_id": row["family_id"] if "family_id" in keys else None, "family": row["family_name"] if "family_name" in keys else None, "favorite": bool(row["favorite"]) if "favorite" in keys else False, "variant_of_id": row["variant_of_id"] if "variant_of_id" in keys else None}


def pattern_query(db, where="", args=(), order="pat.updated_at DESC, pat.id DESC"):
    return db.execute(
        f"""SELECT pat.*, fam.name AS family_name FROM patterns pat
            LEFT JOIN pattern_families fam ON fam.id = pat.family_id
            {where} ORDER BY {order}""", args,
    )


def pattern_library_item(row):
    geometry = json.loads(row["geometry_json"])
    piece_count = sum(1 for item in geometry.get("items", []) if item.get("type") == "piece")
    photo_derived = geometry.get("photo_derived", False)
    status = "Digitalizado · revisar" if photo_derived and piece_count else "Foto · falta vectorizar" if photo_derived else "Vectorial"
    return {**pattern_dict(row), "product_label": row["product_label"], "product_count": row["product_count"], "available_sizes": row["available_sizes"], "piece_count": piece_count, "digitization_status": status}


@app.get("/api/pattern-families")
def list_pattern_families():
    with connect() as db:
        rows = db.execute("SELECT f.id, f.name, COUNT(p.id) AS pattern_count FROM pattern_families f LEFT JOIN patterns p ON p.family_id = f.id GROUP BY f.id ORDER BY f.name COLLATE NOCASE").fetchall()
    return [dict(row) for row in rows]


class PatternFamilyInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)


@app.post("/api/pattern-families", status_code=201)
def create_pattern_family(data: PatternFamilyInput):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Escribe un nombre de familia")
    with connect() as db:
        try:
            cursor = db.execute("INSERT INTO pattern_families (name) VALUES (?)", (name,))
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Ya existe esa familia") from error
        return {"id": cursor.lastrowid, "name": name, "pattern_count": 0}


@app.get("/api/patterns")
def list_patterns():
    with connect() as db:
        rows = db.execute(
            """SELECT pat.*, fam.name AS family_name,
                      COALESCE((SELECT GROUP_CONCAT(p.code || ' · ' || p.name, ', ') FROM pattern_products pp JOIN products p ON p.id = pp.product_id WHERE pp.pattern_id = pat.id), p.code || ' · ' || p.name) AS product_label,
                      (SELECT COUNT(*) FROM pattern_products pp WHERE pp.pattern_id = pat.id) + CASE WHEN pat.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pattern_products pp WHERE pp.pattern_id = pat.id AND pp.product_id = pat.product_id) THEN 1 ELSE 0 END AS product_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s.name) FROM pattern_products pp JOIN sizes s ON s.product_id = pp.product_id WHERE pp.pattern_id = pat.id), (SELECT GROUP_CONCAT(s.name) FROM sizes s WHERE s.product_id = pat.product_id), '') AS available_sizes
               FROM patterns pat LEFT JOIN products p ON p.id = pat.product_id LEFT JOIN pattern_families fam ON fam.id = pat.family_id
               ORDER BY pat.updated_at DESC, pat.id DESC"""
        ).fetchall()
    return [pattern_library_item(row) for row in rows]


@app.get("/api/patterns/{pattern_id}")
def get_pattern(pattern_id: int):
    with connect() as db:
        row = pattern_query(db, "WHERE pat.id = ?", (pattern_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Molde no encontrado")
    return pattern_dict(row)


@app.get("/api/patterns/{pattern_id}/versions")
def list_pattern_versions(pattern_id: int):
    with connect() as db:
        if db.execute("SELECT 1 FROM patterns WHERE id = ?", (pattern_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Molde no encontrado")
        rows = db.execute("SELECT version, name, created_at FROM pattern_versions WHERE pattern_id = ? ORDER BY version DESC", (pattern_id,)).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/patterns", status_code=201)
def create_pattern(data: PatternInput):
    geometry_json = serialize_geometry(data.geometry)
    with connect() as db:
        if data.product_id is not None and db.execute("SELECT 1 FROM products WHERE id = ?", (data.product_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        code = data.code or str(data.geometry.get("digitization", {}).get("code", ""))
        if data.family_id is not None and db.execute("SELECT 1 FROM pattern_families WHERE id = ?", (data.family_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Familia de moldes no encontrada")
        cursor = db.execute("INSERT INTO patterns (name, geometry_json, product_id, code, garment_type, pattern_kind, family_id, variant_of_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (data.name.strip(), geometry_json, data.product_id, code, data.garment_type or "", data.pattern_kind or "base", data.family_id, data.variant_of_id))
        pattern_id = cursor.lastrowid
        db.execute("INSERT INTO pattern_versions (pattern_id, version, name, geometry_json) VALUES (?, 1, ?, ?)", (pattern_id, data.name.strip(), geometry_json))
        if data.product_id is not None:
            db.execute("INSERT OR IGNORE INTO pattern_products (pattern_id, product_id) VALUES (?, ?)", (pattern_id, data.product_id))
        row = pattern_query(db, "WHERE pat.id = ?", (pattern_id,)).fetchone()
    return pattern_dict(row)


@app.put("/api/patterns/{pattern_id}")
def update_pattern(pattern_id: int, data: PatternInput):
    geometry_json = serialize_geometry(data.geometry)
    with connect() as db:
        current = db.execute("SELECT * FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Molde no encontrado")
        version = db.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM pattern_versions WHERE pattern_id = ?", (pattern_id,)).fetchone()[0]
        name = data.name.strip()
        if data.product_id is not None and db.execute("SELECT 1 FROM products WHERE id = ?", (data.product_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        family_id = data.family_id if data.family_id is not None else current["family_id"]
        if data.family_id is not None and db.execute("SELECT 1 FROM pattern_families WHERE id = ?", (family_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Familia de moldes no encontrada")
        code = data.code if data.code is not None else current["code"]
        garment_type = data.garment_type if data.garment_type is not None else current["garment_type"]
        pattern_kind = data.pattern_kind if data.pattern_kind is not None else current["pattern_kind"]
        db.execute("UPDATE patterns SET name = ?, geometry_json = ?, product_id = ?, code = ?, garment_type = ?, pattern_kind = ?, family_id = ?, variant_of_id = COALESCE(?, variant_of_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?", (name, geometry_json, data.product_id, code, garment_type, pattern_kind, family_id, data.variant_of_id, pattern_id))
        if data.product_id is not None:
            db.execute("INSERT OR IGNORE INTO pattern_products (pattern_id, product_id) VALUES (?, ?)", (pattern_id, data.product_id))
        db.execute("INSERT INTO pattern_versions (pattern_id, version, name, geometry_json) VALUES (?, ?, ?, ?)", (pattern_id, version, name, geometry_json))
        row = pattern_query(db, "WHERE pat.id = ?", (pattern_id,)).fetchone()
    return pattern_dict(row)


@app.post("/api/patterns/{pattern_id}/duplicate", status_code=201)
def duplicate_pattern(pattern_id: int):
    with connect() as db:
        current = db.execute("SELECT * FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Molde no encontrado")
        name = f"{current['name']} copia"
        cursor = db.execute("INSERT INTO patterns (name, geometry_json, product_id, code, garment_type, pattern_kind, family_id, favorite, variant_of_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (name, current["geometry_json"], current["product_id"], current["code"], current["garment_type"], current["pattern_kind"], current["family_id"], current["favorite"], current["variant_of_id"]))
        new_id = cursor.lastrowid
        db.execute("INSERT OR IGNORE INTO pattern_products (pattern_id, product_id) SELECT ?, product_id FROM pattern_products WHERE pattern_id = ?", (new_id, pattern_id))
        db.execute("INSERT INTO pattern_versions (pattern_id, version, name, geometry_json) VALUES (?, 1, ?, ?)", (new_id, name, current["geometry_json"]))
        row = db.execute("SELECT * FROM patterns WHERE id = ?", (new_id,)).fetchone()
    return pattern_dict(row)


class PatternLibraryInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = Field(default=None, max_length=40)
    garment_type: str | None = Field(default=None, max_length=60)
    pattern_kind: str | None = Field(default=None, pattern="^(base|variant)$")
    family_id: int | None = None
    favorite: bool | None = None
    variant_of_id: int | None = None


@app.patch("/api/patterns/{pattern_id}/library")
def update_pattern_library(pattern_id: int, data: PatternLibraryInput):
    with connect() as db:
        current = db.execute("SELECT * FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Molde no encontrado")
        family_id = data.family_id if "family_id" in data.model_fields_set else current["family_id"]
        if family_id is not None and db.execute("SELECT 1 FROM pattern_families WHERE id = ?", (family_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Familia de moldes no encontrada")
        name = data.name.strip() if data.name is not None else current["name"]
        pattern_kind = data.pattern_kind if data.pattern_kind is not None else current["pattern_kind"]
        variant_of_id = data.variant_of_id if "variant_of_id" in data.model_fields_set else current["variant_of_id"]
        if variant_of_id == pattern_id or (variant_of_id is not None and db.execute("SELECT 1 FROM patterns WHERE id = ?", (variant_of_id,)).fetchone() is None):
            raise HTTPException(status_code=422, detail="El molde base de la variante no es válido")
        if pattern_kind == "base":
            variant_of_id = None
        db.execute("UPDATE patterns SET name = ?, code = ?, garment_type = ?, pattern_kind = ?, family_id = ?, favorite = ?, variant_of_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (name, data.code if data.code is not None else current["code"], data.garment_type if data.garment_type is not None else current["garment_type"], pattern_kind, family_id, int(data.favorite if data.favorite is not None else current["favorite"]), variant_of_id, pattern_id))
        version = db.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM pattern_versions WHERE pattern_id = ?", (pattern_id,)).fetchone()[0]
        db.execute("INSERT INTO pattern_versions (pattern_id, version, name, geometry_json) VALUES (?, ?, ?, ?)", (pattern_id, version, name, current["geometry_json"]))
        row = pattern_query(db, "WHERE pat.id = ?", (pattern_id,)).fetchone()
    return pattern_dict(row)


@app.post("/api/patterns/{pattern_id}/products/{product_id}", status_code=201)
def associate_pattern_product(pattern_id: int, product_id: int):
    with connect() as db:
        if db.execute("SELECT 1 FROM patterns WHERE id = ?", (pattern_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Molde no encontrado")
        if db.execute("SELECT 1 FROM products WHERE id = ?", (product_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        db.execute("INSERT OR IGNORE INTO pattern_products (pattern_id, product_id) VALUES (?, ?)", (pattern_id, product_id))
    return {"pattern_id": pattern_id, "product_id": product_id}


@app.delete("/api/patterns/{pattern_id}/products/{product_id}", status_code=204)
def disassociate_pattern_product(pattern_id: int, product_id: int):
    with connect() as db:
        db.execute("DELETE FROM pattern_products WHERE pattern_id = ? AND product_id = ? AND product_id != (SELECT product_id FROM patterns WHERE id = ?)", (pattern_id, product_id, pattern_id))
    return None


@app.post("/api/patterns/{pattern_id}/restore/{version}")
def restore_pattern_version(pattern_id: int, version: int):
    with connect() as db:
        snapshot = db.execute("SELECT * FROM pattern_versions WHERE pattern_id = ? AND version = ?", (pattern_id, version)).fetchone()
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Versión no encontrada")
        new_version = db.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM pattern_versions WHERE pattern_id = ?", (pattern_id,)).fetchone()[0]
        db.execute("UPDATE patterns SET name = ?, geometry_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (snapshot["name"], snapshot["geometry_json"], pattern_id))
        db.execute("INSERT INTO pattern_versions (pattern_id, version, name, geometry_json) VALUES (?, ?, ?, ?)", (pattern_id, new_version, snapshot["name"], snapshot["geometry_json"]))
        row = db.execute("SELECT * FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
    return pattern_dict(row)


@app.delete("/api/patterns/{pattern_id}", status_code=204)
def delete_pattern(pattern_id: int):
    with connect() as db:
        cursor = db.execute("DELETE FROM patterns WHERE id = ?", (pattern_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Molde no encontrado")


def product_category_id(db, name: str) -> int | None:
    if not name:
        return None
    db.execute("INSERT INTO categories (name) VALUES (?) ON CONFLICT(name) DO NOTHING", (name,))
    return db.execute("SELECT id FROM categories WHERE name = ?", (name,)).fetchone()[0]


def product_row(db, product_id: int):
    return db.execute(
        """SELECT p.*, c.name AS category FROM products p
           LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?""",
        (product_id,),
    ).fetchone()


def product_history(db, product_id: int, event: str, details: dict[str, Any]):
    db.execute("INSERT INTO product_history (product_id, event, details_json) VALUES (?, ?, ?)", (product_id, event, json.dumps(details, separators=(",", ":"))))


def product_output(row) -> dict[str, Any]:
    return {key: row[key] for key in ("id", "code", "name", "category", "description", "reference_image", "status", "notes", "created_at", "updated_at")}


def require_product(db, product_id: int):
    row = product_row(db, product_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return row


@app.get("/api/products")
def list_products():
    with connect() as db:
        rows = db.execute(
            """SELECT p.id, p.code, p.name, COALESCE(c.name, '') AS category, p.description, p.notes, p.status, p.updated_at,
                      (SELECT COUNT(*) FROM (SELECT pat.id FROM patterns pat WHERE pat.product_id = p.id UNION SELECT pp.pattern_id FROM pattern_products pp WHERE pp.product_id = p.id)) AS pattern_count,
                      (SELECT COUNT(*) FROM sizes s WHERE s.product_id = p.id) AS size_count
               FROM products p LEFT JOIN categories c ON c.id = p.category_id
               ORDER BY p.updated_at DESC, p.id DESC"""
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/products", status_code=201)
def create_product(data: ProductInput):
    with connect() as db:
        category_id = product_category_id(db, data.category)
        try:
            cursor = db.execute(
                "INSERT INTO products (code, name, category_id, description, reference_image, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (data.code, data.name, category_id, data.description, data.reference_image, data.status, data.notes),
            )
        except sqlite3.IntegrityError as error:
            if "UNIQUE constraint failed: products.code" in str(error):
                raise HTTPException(status_code=409, detail="Ya existe un producto con ese código") from error
            raise
        product_id = cursor.lastrowid
        product_history(db, product_id, "created", {"code": data.code, "name": data.name})
        row = product_row(db, product_id)
    return product_output(row)


@app.get("/api/products/{product_id}")
def get_product(product_id: int):
    with connect() as db:
        product = product_output(require_product(db, product_id))
        patterns = [dict(row) for row in db.execute("SELECT DISTINCT pat.id, pat.name, pat.updated_at FROM patterns pat LEFT JOIN pattern_products pp ON pp.pattern_id = pat.id WHERE pat.product_id = ? OR pp.product_id = ? ORDER BY pat.id", (product_id, product_id))]
        sizes = [dict(row) for row in db.execute("SELECT id, name, sort_order FROM sizes WHERE product_id = ? ORDER BY sort_order, id", (product_id,))]
        measurements = [dict(row) for row in db.execute("SELECT id, name, description, tolerance_cm, sort_order FROM measurement_definitions WHERE product_id = ? ORDER BY sort_order, id", (product_id,))]
        materials = [dict(row) for row in db.execute(
            """SELECT m.*, pm.quantity, pm.quantity_kind, pm.notes AS product_notes
               FROM product_materials pm JOIN materials m ON m.id = pm.material_id
               WHERE pm.product_id = ? ORDER BY m.name""", (product_id,))]
        values = [dict(row) for row in db.execute(
            """SELECT sm.size_id, sm.measurement_id, sm.value_cm
               FROM size_measurements sm JOIN sizes s ON s.id = sm.size_id
               WHERE s.product_id = ?""", (product_id,))]
        rules = [dict(row) for row in db.execute(
            """SELECT sr.* FROM scaling_rules sr JOIN measurement_definitions md ON md.id = sr.measurement_id
               WHERE md.product_id = ? ORDER BY sr.id""", (product_id,))]
        sheet_count = db.execute("SELECT COUNT(*) FROM technical_sheets WHERE product_id = ?", (product_id,)).fetchone()[0]
    return {**product, "patterns": patterns, "sizes": sizes, "measurements": measurements, "measurement_values": values, "materials": materials, "scaling_rules": rules, "sheet_count": sheet_count}


@app.get("/api/products/{product_id}/history")
def get_product_history(product_id: int):
    with connect() as db:
        require_product(db, product_id)
        rows = db.execute("SELECT event, details_json, created_at FROM product_history WHERE product_id = ? ORDER BY id DESC LIMIT 100", (product_id,)).fetchall()
    return [{**dict(row), "details": json.loads(row["details_json"])} for row in rows]


@app.put("/api/products/{product_id}")
def update_product(product_id: int, data: ProductInput):
    with connect() as db:
        current = require_product(db, product_id)
        category_id = product_category_id(db, data.category)
        try:
            db.execute(
                """UPDATE products SET code = ?, name = ?, category_id = ?, description = ?, reference_image = ?, status = ?, notes = ?,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (data.code, data.name, category_id, data.description, data.reference_image, data.status, data.notes, product_id),
            )
        except sqlite3.IntegrityError as error:
            if "UNIQUE constraint failed: products.code" in str(error):
                raise HTTPException(status_code=409, detail="Ya existe un producto con ese código") from error
            raise
        changed = [key for key in ("code", "name", "description", "status", "notes", "reference_image") if current[key] != getattr(data, key)]
        if current["category"] != data.category:
            changed.append("category")
        product_history(db, product_id, "updated", {"fields": changed})
        row = product_row(db, product_id)
    return product_output(row)


@app.delete("/api/products/{product_id}", status_code=204)
def delete_product(product_id: int):
    with connect() as db:
        require_product(db, product_id)
        db.execute("DELETE FROM products WHERE id = ?", (product_id,))


@app.post("/api/products/{product_id}/duplicate", status_code=201)
def duplicate_product(product_id: int):
    with connect() as db:
        source = require_product(db, product_id)
        base_code = f"{source['code']}-C"
        code, suffix = base_code, 2
        while db.execute("SELECT 1 FROM products WHERE code = ?", (code,)).fetchone():
            code, suffix = f"{base_code}{suffix}", suffix + 1
        category_id = source["category_id"]
        cursor = db.execute(
            "INSERT INTO products (code, name, category_id, description, reference_image, status, notes) VALUES (?, ?, ?, ?, ?, 'draft', ?)",
            (code, f"{source['name']} copia", category_id, source["description"], source["reference_image"], source["notes"]),
        )
        copy_id = cursor.lastrowid
        size_map: dict[int, int] = {}
        for size in db.execute("SELECT * FROM sizes WHERE product_id = ?", (product_id,)):
            new_size_id = db.execute("INSERT INTO sizes (product_id, name, sort_order) VALUES (?, ?, ?)", (copy_id, size["name"], size["sort_order"])).lastrowid
            size_map[size["id"]] = new_size_id
        measurement_map: dict[int, int] = {}
        for definition in db.execute("SELECT * FROM measurement_definitions WHERE product_id = ?", (product_id,)):
            new_measurement_id = db.execute(
                "INSERT INTO measurement_definitions (product_id, name, description, tolerance_cm, sort_order) VALUES (?, ?, ?, ?, ?)",
                (copy_id, definition["name"], definition["description"], definition["tolerance_cm"], definition["sort_order"]),
            ).lastrowid
            measurement_map[definition["id"]] = new_measurement_id
        for value in db.execute("SELECT sm.* FROM size_measurements sm JOIN sizes s ON s.id = sm.size_id WHERE s.product_id = ?", (product_id,)):
            if value["size_id"] in size_map and value["measurement_id"] in measurement_map:
                db.execute("INSERT INTO size_measurements (size_id, measurement_id, value_cm) VALUES (?, ?, ?)", (size_map[value["size_id"]], measurement_map[value["measurement_id"]], value["value_cm"]))
        for material in db.execute("SELECT * FROM product_materials WHERE product_id = ?", (product_id,)):
            db.execute("INSERT INTO product_materials (product_id, material_id, quantity, quantity_kind, notes) VALUES (?, ?, ?, ?, ?)", (copy_id, material["material_id"], material["quantity"], material["quantity_kind"], material["notes"]))
        for pattern in db.execute("SELECT DISTINCT pat.id FROM patterns pat LEFT JOIN pattern_products pp ON pp.pattern_id = pat.id WHERE pat.product_id = ? OR pp.product_id = ?", (product_id, product_id)):
            db.execute("INSERT OR IGNORE INTO pattern_products (pattern_id, product_id) VALUES (?, ?)", (pattern["id"], copy_id))
        product_history(db, copy_id, "duplicated", {"source_id": product_id})
        row = product_row(db, copy_id)
    return product_output(row)


@app.post("/api/products/{product_id}/patterns/{pattern_id}")
def attach_pattern(product_id: int, pattern_id: int):
    with connect() as db:
        require_product(db, product_id)
        if db.execute("SELECT 1 FROM patterns WHERE id = ?", (pattern_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Molde no encontrado")
        db.execute("INSERT OR IGNORE INTO pattern_products (pattern_id, product_id) VALUES (?, ?)", (pattern_id, product_id))
        product_history(db, product_id, "pattern_attached", {"pattern_id": pattern_id})
        row = db.execute("SELECT id, name, updated_at FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
    return dict(row)


@app.delete("/api/products/{product_id}/patterns/{pattern_id}", status_code=204)
def detach_pattern(product_id: int, pattern_id: int):
    with connect() as db:
        require_product(db, product_id)
        cursor = db.execute("DELETE FROM pattern_products WHERE pattern_id = ? AND product_id = ?", (pattern_id, product_id))
        legacy = db.execute("SELECT product_id FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
        if cursor.rowcount == 0 and (legacy is None or legacy["product_id"] != product_id):
            raise HTTPException(status_code=404, detail="Molde no asociado a este producto")
        if legacy is not None and legacy["product_id"] == product_id:
            db.execute("UPDATE patterns SET product_id = NULL WHERE id = ?", (pattern_id,))
        product_history(db, product_id, "pattern_detached", {"pattern_id": pattern_id})


@app.post("/api/products/{product_id}/sizes", status_code=201)
def add_size(product_id: int, data: SizeInput):
    with connect() as db:
        require_product(db, product_id)
        try:
            row = db.execute("INSERT INTO sizes (product_id, name, sort_order) VALUES (?, ?, ?) RETURNING id, name, sort_order", (product_id, data.name, data.sort_order)).fetchone()
        except Exception as error:
            if "UNIQUE constraint failed: sizes.product_id, sizes.name" in str(error):
                raise HTTPException(status_code=409, detail="Esa talla ya existe en este producto") from error
            raise
        product_history(db, product_id, "size_added", dict(row))
    return dict(row)


@app.delete("/api/products/{product_id}/sizes/{size_id}", status_code=204)
def delete_size(product_id: int, size_id: int):
    with connect() as db:
        require_product(db, product_id)
        cursor = db.execute("DELETE FROM sizes WHERE id = ? AND product_id = ?", (size_id, product_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Talla no encontrada")
        product_history(db, product_id, "size_removed", {"size_id": size_id})


@app.post("/api/products/{product_id}/measurements", status_code=201)
def add_measurement(product_id: int, data: MeasurementInput):
    with connect() as db:
        require_product(db, product_id)
        try:
            row = db.execute(
                "INSERT INTO measurement_definitions (product_id, name, description, tolerance_cm) VALUES (?, ?, ?, ?) RETURNING id, name, description, tolerance_cm, sort_order",
                (product_id, data.name, data.description, data.tolerance_cm),
            ).fetchone()
        except Exception as error:
            if "UNIQUE constraint failed: measurement_definitions.product_id, measurement_definitions.name" in str(error):
                raise HTTPException(status_code=409, detail="Esa medida ya existe en este producto") from error
            raise
        product_history(db, product_id, "measurement_added", dict(row))
    return dict(row)


@app.put("/api/products/{product_id}/measurements/{measurement_id}/values")
def save_measurement_values(product_id: int, measurement_id: int, data: MeasurementValuesInput):
    with connect() as db:
        require_product(db, product_id)
        if db.execute("SELECT 1 FROM measurement_definitions WHERE id = ? AND product_id = ?", (measurement_id, product_id)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Medida no encontrada")
        for size_id, value in data.values.items():
            if db.execute("SELECT 1 FROM sizes WHERE id = ? AND product_id = ?", (size_id, product_id)).fetchone() is None:
                raise HTTPException(status_code=422, detail=f"La talla {size_id} no pertenece a este producto")
            if value is None:
                db.execute("DELETE FROM size_measurements WHERE size_id = ? AND measurement_id = ?", (size_id, measurement_id))
            else:
                db.execute("INSERT INTO size_measurements (size_id, measurement_id, value_cm) VALUES (?, ?, ?) ON CONFLICT(size_id, measurement_id) DO UPDATE SET value_cm = excluded.value_cm", (size_id, measurement_id, value))
        product_history(db, product_id, "measurement_values_saved", {"measurement_id": measurement_id, "sizes": len(data.values)})
    return {"saved": len(data.values)}


@app.post("/api/products/{product_id}/scaling-rules", status_code=201)
def save_scaling_rule(product_id: int, data: ScalingRuleInput):
    with connect() as db:
        require_product(db, product_id)
        if db.execute("SELECT 1 FROM measurement_definitions WHERE id = ? AND product_id = ?", (data.measurement_id, product_id)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Medida no encontrada")
        for size_id in (data.from_size_id, data.to_size_id):
            if db.execute("SELECT 1 FROM sizes WHERE id = ? AND product_id = ?", (size_id, product_id)).fetchone() is None:
                raise HTTPException(status_code=422, detail="Las tallas deben pertenecer al producto")
        row = db.execute(
            """INSERT INTO scaling_rules (measurement_id, from_size_id, to_size_id, increment_cm)
               VALUES (?, ?, ?, ?) ON CONFLICT(measurement_id, from_size_id, to_size_id)
               DO UPDATE SET increment_cm = excluded.increment_cm RETURNING *""",
            (data.measurement_id, data.from_size_id, data.to_size_id, data.increment_cm),
        ).fetchone()
        product_history(db, product_id, "scaling_rule_saved", dict(row))
    return dict(row)


@app.get("/api/materials")
def list_materials():
    with connect() as db:
        rows = db.execute("SELECT * FROM materials ORDER BY name, id").fetchall()
    return [dict(row) for row in rows]


@app.post("/api/materials", status_code=201)
def create_material(data: MaterialInput):
    with connect() as db:
        row = db.execute(
            """INSERT INTO materials (name, kind, color, composition, width_mm, supplier, unit, unit_price, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            (data.name, data.kind, data.color, data.composition, data.width_mm, data.supplier, data.unit, data.unit_price, data.notes),
        ).fetchone()
    return dict(row)


@app.put("/api/materials/{material_id}")
def update_material(material_id: int, data: MaterialInput):
    with connect() as db:
        row = db.execute(
            """UPDATE materials SET name=?, kind=?, color=?, composition=?, width_mm=?, supplier=?, unit=?, unit_price=?, notes=?
               WHERE id=? RETURNING *""",
            (data.name, data.kind, data.color, data.composition, data.width_mm, data.supplier, data.unit, data.unit_price, data.notes, material_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Material no encontrado")
    return dict(row)


@app.delete("/api/materials/{material_id}", status_code=204)
def delete_material(material_id: int):
    with connect() as db:
        try:
            cursor = db.execute("DELETE FROM materials WHERE id = ?", (material_id,))
        except Exception as error:
            if "FOREIGN KEY constraint failed" in str(error):
                raise HTTPException(status_code=409, detail="Desvincula primero el material de los productos") from error
            raise
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Material no encontrado")


@app.post("/api/products/{product_id}/materials", status_code=201)
def attach_material(product_id: int, data: ProductMaterialInput):
    with connect() as db:
        require_product(db, product_id)
        if db.execute("SELECT 1 FROM materials WHERE id = ?", (data.material_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Material no encontrado")
        db.execute(
            """INSERT INTO product_materials (product_id, material_id, quantity, quantity_kind, notes)
               VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id, material_id) DO UPDATE SET quantity=excluded.quantity, quantity_kind=excluded.quantity_kind, notes=excluded.notes""",
            (product_id, data.material_id, data.quantity, data.quantity_kind, data.notes),
        )
        product_history(db, product_id, "material_attached", data.model_dump())
    return {"saved": True}


@app.delete("/api/products/{product_id}/materials/{material_id}", status_code=204)
def detach_material(product_id: int, material_id: int):
    with connect() as db:
        require_product(db, product_id)
        cursor = db.execute("DELETE FROM product_materials WHERE product_id = ? AND material_id = ?", (product_id, material_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Material no asociado a este producto")
        product_history(db, product_id, "material_detached", {"material_id": material_id})


@app.post("/api/products/{product_id}/materials/{material_id}/estimate")
def estimate_consumption(product_id: int, material_id: int, data: EstimateInput):
    with connect() as db:
        require_product(db, product_id)
        material = db.execute("SELECT width_mm FROM materials WHERE id = ?", (material_id,)).fetchone()
        if material is None:
            raise HTTPException(status_code=404, detail="Material no encontrado")
        if not material["width_mm"]:
            raise HTTPException(status_code=422, detail="Registra el ancho de la tela antes de estimar")
        areas = []
        rows = db.execute("SELECT geometry_json FROM patterns WHERE product_id = ?", (product_id,)).fetchall()
        for row in rows:
            geometry = json.loads(row["geometry_json"])
            for item in geometry.get("items", []):
                if item.get("type") == "piece" and len(item.get("vertices", [])) >= 3:
                    vertices = item["vertices"]
                    areas.append(abs(sum(point["x"] * vertices[(i + 1) % len(vertices)]["y"] - vertices[(i + 1) % len(vertices)]["x"] * point["y"] for i, point in enumerate(vertices))) / 2)
        if not areas:
            raise HTTPException(status_code=422, detail="Asocia moldes con contornos cerrados para estimar el consumo")
        area_mm2 = sum(areas)
        length_mm = area_mm2 / material["width_mm"] * (1 + data.wastage_percent / 100)
        quantity_m = length_mm / 1000
        product_history(db, product_id, "consumption_estimated", {"material_id": material_id, "quantity_m": quantity_m, "wastage_percent": data.wastage_percent})
    return {"quantity": round(quantity_m, 3), "unit": "m", "kind": "estimated", "area_m2": round(area_mm2 / 1_000_000, 3), "wastage_percent": data.wastage_percent, "basis": "Área geométrica de contornos cerrados ÷ ancho de tela. No incluye distribución de piezas, márgenes de costura ni optimización de tizado."}


def insert_sheet(db, product_id: int, kind: str, content: dict[str, Any]):
    if kind not in {"construction", "measurement"}:
        raise HTTPException(status_code=422, detail="Tipo de ficha no válido")
    encoded = json.dumps(content, separators=(",", ":"), allow_nan=False)
    if len(encoded) > 12_000_000:
        raise HTTPException(status_code=413, detail="La ficha supera el límite de 12 MB")
    version = db.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM technical_sheets WHERE product_id = ? AND kind = ?", (product_id, kind)).fetchone()[0]
    row = db.execute("INSERT INTO technical_sheets (product_id, kind, version, content_json) VALUES (?, ?, ?, ?) RETURNING id, kind, version, created_at", (product_id, kind, version, encoded)).fetchone()
    product_history(db, product_id, "sheet_saved", {"sheet_id": row["id"], "kind": kind, "version": version})
    return dict(row)


@app.get("/api/products/{product_id}/sheets")
def list_sheets(product_id: int):
    with connect() as db:
        require_product(db, product_id)
        rows = db.execute("SELECT id, kind, version, created_at FROM technical_sheets WHERE product_id = ? ORDER BY kind, version DESC", (product_id,)).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/sheets/{sheet_id}")
def get_sheet(sheet_id: int):
    with connect() as db:
        row = db.execute("SELECT id, product_id, kind, version, content_json, created_at FROM technical_sheets WHERE id = ?", (sheet_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Ficha no encontrada")
    return {**dict(row), "content": json.loads(row["content_json"])}


@app.put("/api/sheets/{sheet_id}")
def update_sheet(sheet_id: int, data: SheetInput):
    encoded = json.dumps(data.content, separators=(",", ":"), allow_nan=False)
    if len(encoded) > 12_000_000:
        raise HTTPException(status_code=413, detail="La ficha supera el límite de 12 MB")
    with connect() as db:
        cursor = db.execute("UPDATE technical_sheets SET content_json = ? WHERE id = ?", (encoded, sheet_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Ficha no encontrada")
        row = db.execute("SELECT id, product_id, kind, version, content_json, created_at FROM technical_sheets WHERE id = ?", (sheet_id,)).fetchone()
    return {**dict(row), "content": json.loads(row["content_json"])}


@app.post("/api/products/{product_id}/sheets/{kind}/generate", status_code=201)
def generate_sheet(product_id: int, kind: str):
    detail = get_product(product_id)
    product = {key: detail[key] for key in ("id", "code", "name", "category", "description", "reference_image", "notes")}
    if kind == "construction":
        pieces = []
        with connect() as db:
            patterns = db.execute("SELECT id, name, geometry_json FROM patterns WHERE product_id = ?", (product_id,)).fetchall()
            for pattern in patterns:
                entity_count = len(json.loads(pattern["geometry_json"]).get("items", []))
                pieces.append({"pattern_id": pattern["id"], "name": pattern["name"], "entity_count": entity_count})
        content = {"product": product, "materials": detail["materials"], "patterns": pieces, "sizes": detail["sizes"], "measurements": detail["measurements"], "measurement_values": detail["measurement_values"], "operations": [], "observations": detail["notes"]}
    elif kind == "measurement":
        values: dict[str, dict[str, float]] = {}
        for row in detail["measurement_values"]:
            values.setdefault(str(row["measurement_id"]), {})[str(row["size_id"])] = row["value_cm"]
        content = {"product": product, "sizes": detail["sizes"], "measurements": detail["measurements"], "values": values, "drawings": {"front": None, "back": None}, "observations": ""}
    else:
        raise HTTPException(status_code=422, detail="Tipo de ficha no válido")
    with connect() as db:
        require_product(db, product_id)
        return insert_sheet(db, product_id, kind, content)


@app.post("/api/products/{product_id}/sheets/{kind}", status_code=201)
def save_sheet(product_id: int, kind: str, data: SheetInput):
    with connect() as db:
        require_product(db, product_id)
        return insert_sheet(db, product_id, kind, data.content)


@app.get("/api/sheet-templates")
def list_sheet_templates():
    with connect() as db:
        rows=db.execute("SELECT id,name,content_json,updated_at FROM sheet_templates ORDER BY name").fetchall()
    return [{"id":row["id"],"name":row["name"],"content":json.loads(row["content_json"]),"updated_at":row["updated_at"]} for row in rows]


@app.post("/api/sheet-templates", status_code=201)
def create_sheet_template(data: SheetTemplateInput):
    encoded=json.dumps(data.content,separators=(",",":"),allow_nan=False)
    if len(encoded)>4_500_000:
        raise HTTPException(status_code=413,detail="La plantilla supera el límite de 4,5 MB")
    with connect() as db:
        try:
            row=db.execute("INSERT INTO sheet_templates (name,content_json) VALUES (?,?) RETURNING id,name,content_json,updated_at",(data.name,encoded)).fetchone()
        except Exception as error:
            if "UNIQUE constraint failed" in str(error): raise HTTPException(status_code=409,detail="Ya existe una plantilla con ese nombre") from error
            raise
    return {"id":row["id"],"name":row["name"],"content":json.loads(row["content_json"]),"updated_at":row["updated_at"]}


@app.put("/api/sheet-templates/{template_id}")
def update_sheet_template(template_id: int, data: SheetTemplateInput):
    encoded=json.dumps(data.content,separators=(",",":"),allow_nan=False)
    if len(encoded)>4_500_000:
        raise HTTPException(status_code=413,detail="La plantilla supera el límite de 4,5 MB")
    with connect() as db:
        try:
            cursor=db.execute("UPDATE sheet_templates SET name=?,content_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(data.name,encoded,template_id))
        except Exception as error:
            if "UNIQUE constraint failed" in str(error): raise HTTPException(status_code=409,detail="Ya existe una plantilla con ese nombre") from error
            raise
        if cursor.rowcount==0: raise HTTPException(status_code=404,detail="Plantilla no encontrada")
        row=db.execute("SELECT id,name,content_json,updated_at FROM sheet_templates WHERE id=?",(template_id,)).fetchone()
    return {"id":row["id"],"name":row["name"],"content":json.loads(row["content_json"]),"updated_at":row["updated_at"]}
