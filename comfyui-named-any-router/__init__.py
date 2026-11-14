from comfy_api.latest import io
from comfy_execution.graph_utils import ExecutionBlocker, GraphBuilder, is_link


MAX_PORTS = 20
INPUT_KEYS = [f"inputs.input_{i}" for i in range(MAX_PORTS)]
OUTPUT_KEYS = [f"output_{i}" for i in range(MAX_PORTS)]
WEB_DIRECTORY = "./web"


class RouterInputs(dict):
    def __contains__(self, key):
        return key in INPUT_KEYS or super().__contains__(key)

    def __getitem__(self, key):
        if key in INPUT_KEYS:
            return ("*", {"lazy": True, "rawLink": True})
        return super().__getitem__(key)


class NamedAnyRouter:
    @classmethod
    def INPUT_TYPES(cls):
        autogrow = io.Autogrow.Input(
            "inputs",
            template=io.Autogrow.TemplatePrefix(
                io.AnyType.Input("value", optional=True, lazy=True),
                prefix="input_", min=1, max=MAX_PORTS,
            ),
            optional=True,
        )
        return {
            "required": {
                "input_selector": (INPUT_KEYS, {"default": INPUT_KEYS[0], "socketless": True}),
                "output_selector": (OUTPUT_KEYS, {"default": OUTPUT_KEYS[0], "socketless": True}),
            },
            "optional": RouterInputs({"inputs": (autogrow.io_type, autogrow.as_dict())}),
            "hidden": {"_resolved_value": ("*", {"lazy": True})},
        }

    RETURN_TYPES = ("*",) * MAX_PORTS
    RETURN_NAMES = tuple(f"output_{i + 1}" for i in range(MAX_PORTS))
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,) * MAX_PORTS
    FUNCTION = "route"
    CATEGORY = "utilities/switch"
    DESCRIPTION = "Route one named input to one named destination. Other output paths are blocked. Accepts any data type."

    @classmethod
    def VALIDATE_INPUTS(cls, input_selector, output_selector):
        if len(input_selector) != 1 or input_selector[0] not in INPUT_KEYS:
            return "Connect an input and select its source."
        if len(output_selector) != 1 or output_selector[0] not in OUTPUT_KEYS:
            return "Connect an output and select its destination."
        return True

    def check_lazy_status(self, input_selector, output_selector, **inputs):
        if "_resolved_value" in inputs:
            value = inputs["_resolved_value"]
            missing = value is None or (isinstance(value, tuple) and len(value) == 1 and value[0] is None)
            return ["_resolved_value"] if missing else []
        key = input_selector[0]
        if key not in inputs:
            raise ValueError("The selected input is disconnected. Select a connected source.")
        return []

    def route(self, input_selector, output_selector, **inputs):
        if "_resolved_value" in inputs:
            # Nest once so expansion resolves an execution list as one output, not multiple ports.
            return ([inputs["_resolved_value"]],) + tuple([ExecutionBlocker(None)] for _ in OUTPUT_KEYS[1:])
        key = input_selector[0]
        if key not in inputs:
            raise ValueError("The selected input is disconnected. Select a connected source.")
        value = inputs[key]
        if len(value) == 1 and is_link(value[0]):
            # Resolve only the selected link; blockers on other inputs must not enter this node.
            graph = GraphBuilder()
            resolved = graph.node("NamedAnyRouter", input_selector=INPUT_KEYS[0], output_selector=OUTPUT_KEYS[0], _resolved_value=value[0])
            result = tuple(resolved.out(0) if output == output_selector[0] else [ExecutionBlocker(None)] for output in OUTPUT_KEYS)
            return {"expand": graph.finalize(), "result": result}
        return tuple(value if output == output_selector[0] else [ExecutionBlocker(None)] for output in OUTPUT_KEYS)


NODE_CLASS_MAPPINGS = {"NamedAnyRouter": NamedAnyRouter}
NODE_DISPLAY_NAME_MAPPINGS = {"NamedAnyRouter": "Named Any Router"}
