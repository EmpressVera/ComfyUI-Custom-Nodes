from comfy_api.latest import io


MAX_INPUTS = 20
SELECTIONS = [f"inputs.input_{i}" for i in range(MAX_INPUTS)]
WEB_DIRECTORY = "./web"


class SwitchInputs(dict):
    def __contains__(self, key):
        return key in SELECTIONS or super().__contains__(key)

    def __getitem__(self, key):
        if key in SELECTIONS:
            return ("*", {"lazy": True})
        return super().__getitem__(key)


class NamedAnySwitch:
    @classmethod
    def INPUT_TYPES(cls):
        autogrow = io.Autogrow.Input(
            "inputs",
            template=io.Autogrow.TemplatePrefix(
                io.AnyType.Input("value", optional=True, lazy=True),
                prefix="input_",
                min=1,
                max=MAX_INPUTS,
            ),
            optional=True,
        )
        # Expose native autogrow in the UI and individual lazy sockets to the scheduler.
        return {
            "required": {
                "selector": (SELECTIONS, {"default": SELECTIONS[0], "socketless": True}),
            },
            "optional": SwitchInputs({
                "inputs": (autogrow.io_type, autogrow.as_dict()),
            }),
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("output",)
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "switch"
    CATEGORY = "utilities/switch"
    DESCRIPTION = "Pass through the selected connected node. Accepts any data type."

    @classmethod
    def VALIDATE_INPUTS(cls, selector):
        if len(selector) != 1 or selector[0] not in SELECTIONS:
            return "Connect an input and select its node in the dropdown."
        return True

    def check_lazy_status(self, selector, **inputs):
        key = selector[0]
        if key not in inputs:
            raise ValueError("The selected input is disconnected. Select a connected node.")
        value = inputs[key]
        if value is None or (len(value) == 1 and value[0] is None):
            return [key]
        return []

    def switch(self, selector, **inputs):
        key = selector[0]
        if key not in inputs:
            raise ValueError("The selected input is disconnected. Select a connected node.")
        # Forward ComfyUI's execution list intact, including batches and list outputs.
        return (inputs[key],)


NODE_CLASS_MAPPINGS = {"NamedAnySwitch": NamedAnySwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"NamedAnySwitch": "Named Any Switch"}
