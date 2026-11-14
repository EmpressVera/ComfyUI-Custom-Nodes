from comfy_execution.graph_utils import ExecutionBlocker


WEB_DIRECTORY = "./web"


class GhostNodeSender:
    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {"value": ("*",)}}

    RETURN_TYPES = ("GHOST",)
    RETURN_NAMES = ("ghost",)
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "send"
    CATEGORY = "Ghost Nodes"
    DESCRIPTION = "Send any data to Ghost Node Receivers through a real, optionally invisible connection."

    def send(self, value=None):
        return (value if value is not None else [ExecutionBlocker(None)],)


class GhostNodeReceiver:
    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {"ghost": ("GHOST",)}}

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("output",)
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "receive"
    CATEGORY = "Ghost Nodes"
    DESCRIPTION = "Receive any data from a Ghost Node Sender. A disconnected receiver blocks its downstream branch."

    def receive(self, ghost=None):
        return (ghost if ghost is not None else [ExecutionBlocker(None)],)


NODE_CLASS_MAPPINGS = {
    "GhostNodePair": GhostNodeSender,
    "GhostNodeSender": GhostNodeSender,
    "GhostNodeReceiver": GhostNodeReceiver,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "GhostNodePair": "Ghost Node Pair",
    "GhostNodeSender": "Ghost Node Sender",
    "GhostNodeReceiver": "Ghost Node Receiver",
}
