from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AnalysisStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UNKNOWN: _ClassVar[AnalysisStatus]
    SUCCESS: _ClassVar[AnalysisStatus]
    FAILED: _ClassVar[AnalysisStatus]
UNKNOWN: AnalysisStatus
SUCCESS: AnalysisStatus
FAILED: AnalysisStatus

class SqlAnalysisRequest(_message.Message):
    __slots__ = ("file_path",)
    FILE_PATH_FIELD_NUMBER: _ClassVar[int]
    file_path: str
    def __init__(self, file_path: _Optional[str] = ...) -> None: ...

class SqlAnalysisResponse(_message.Message):
    __slots__ = ("analysis_results_json", "status")
    ANALYSIS_RESULTS_JSON_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    analysis_results_json: str
    status: AnalysisStatus
    def __init__(self, analysis_results_json: _Optional[str] = ..., status: _Optional[_Union[AnalysisStatus, str]] = ...) -> None: ...
