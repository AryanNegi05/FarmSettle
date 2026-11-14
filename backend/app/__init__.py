import os

# gRPC's default DNS resolver fails ("Could not contact DNS servers") on some
# macOS/Python 3.14 setups, which hangs every Firestore call. Must be set before
# grpc is first imported, so it lives in the package root.
os.environ.setdefault("GRPC_DNS_RESOLVER", "native")
