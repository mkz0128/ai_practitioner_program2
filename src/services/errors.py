from pydantic import BaseModel, ConfigDict


class FieldError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    code: str
    message: str
    value_summary: str | None = None


class ValidationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_valid: bool
    errors: list[FieldError] = []
    warnings: list[FieldError] = []
