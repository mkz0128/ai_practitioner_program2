from pydantic import BaseModel, ConfigDict, model_validator


class FieldError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    code: str
    message: str
    value_summary: str | None = None
    requires_manual_review: bool = False


class ValidationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_valid: bool
    errors: list[FieldError] = []
    warnings: list[FieldError] = []
    requires_manual_review: bool = False

    @model_validator(mode="after")
    def derive_manual_review(self) -> "ValidationReport":
        """Make manual-review state impossible to lose at report boundaries."""
        if any(error.requires_manual_review for error in self.errors):
            self.requires_manual_review = True
        return self
