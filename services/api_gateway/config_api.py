from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, BaseSettings
from typing import List, Dict, Any
import os

class ConfigSettings(BaseSettings):
    watched_dirs: List[str] = []
    ignored_patterns: List[str] = []
    lang_extension_map: Dict[str, List[str]] = {}

    class Config:
        env_prefix = "CODEGRAPH_"
        case_sensitive = False

# In-memory config store (populated from env at startup)
settings = ConfigSettings(
    watched_dirs=os.getenv("CODEGRAPH_WATCHED_DIRS", "").split(",") if os.getenv("CODEGRAPH_WATCHED_DIRS") else [],
    ignored_patterns=os.getenv("CODEGRAPH_IGNORED_PATTERNS", "").split(",") if os.getenv("CODEGRAPH_IGNORED_PATTERNS") else [],
    lang_extension_map=eval(os.getenv("CODEGRAPH_LANG_EXTENSION_MAP", "{}")) if os.getenv("CODEGRAPH_LANG_EXTENSION_MAP") else {}
)

router = APIRouter(prefix="/config", tags=["Configuration"])

class WatchedDirsModel(BaseModel):
    watched_dirs: List[str]

class IgnoredPatternsModel(BaseModel):
    ignored_patterns: List[str]

class LangExtensionMapModel(BaseModel):
    lang_extension_map: Dict[str, List[str]]

@router.get("/watched_dirs", response_model=WatchedDirsModel)
def get_watched_dirs():
    return {"watched_dirs": settings.watched_dirs}

@router.post("/watched_dirs", response_model=WatchedDirsModel)
def set_watched_dirs(data: WatchedDirsModel):
    settings.watched_dirs = data.watched_dirs
    return {"watched_dirs": settings.watched_dirs}

@router.get("/ignored_patterns", response_model=IgnoredPatternsModel)
def get_ignored_patterns():
    return {"ignored_patterns": settings.ignored_patterns}

@router.post("/ignored_patterns", response_model=IgnoredPatternsModel)
def set_ignored_patterns(data: IgnoredPatternsModel):
    settings.ignored_patterns = data.ignored_patterns
    return {"ignored_patterns": settings.ignored_patterns}

@router.get("/lang_extension_map", response_model=LangExtensionMapModel)
def get_lang_extension_map():
    return {"lang_extension_map": settings.lang_extension_map}

@router.post("/lang_extension_map", response_model=LangExtensionMapModel)
def set_lang_extension_map(data: LangExtensionMapModel):
    settings.lang_extension_map = data.lang_extension_map
    return {"lang_extension_map": settings.lang_extension_map}