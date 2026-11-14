"""Install the node packages in this repository into ComfyUI."""

import argparse
from pathlib import Path
import shutil
import tempfile


def package_files_match(incoming, installed):
    for source in incoming.rglob("*"):
        if source.is_file():
            target = installed / source.relative_to(incoming)
            if not target.is_file() or source.read_bytes() != target.read_bytes():
                return False
    return True


def install_nodes(repository, custom_nodes):
    if not custom_nodes.is_dir():
        raise ValueError(f"Choose an existing ComfyUI custom_nodes folder: {custom_nodes}")
    if custom_nodes == repository or custom_nodes in repository.parents:
        raise ValueError("Move the downloaded repository outside custom_nodes before installing.")

    packages = sorted(
        folder for folder in repository.glob("comfyui-*")
        if folder.is_dir() and (folder / "__init__.py").is_file()
    )
    if not packages:
        raise ValueError("No node packages found. Keep install.py with the downloaded node folders.")

    license_file = repository / "LICENSE"
    with tempfile.TemporaryDirectory(prefix=".empressvera-install-", dir=custom_nodes) as staging:
        pending = []
        current = []
        conflicts = []
        for package in packages:
            incoming = Path(staging) / package.name
            destination = custom_nodes / package.name
            shutil.copytree(
                package, incoming, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git")
            )
            if license_file.is_file():
                shutil.copy2(license_file, incoming / "LICENSE-EmpressVera")

            if destination.is_symlink() or destination.exists():
                if (
                    not destination.is_symlink()
                    and destination.is_dir()
                    and package_files_match(incoming, destination)
                ):
                    current.append(package.name)
                else:
                    conflicts.append(package.name)
            else:
                pending.append((incoming, destination))

        if conflicts:
            names = "\n  ".join(conflicts)
            raise ValueError(
                f"These existing folders or files differ from the download:\n  {names}\n"
                "Move them outside custom_nodes and run the installer again."
            )

        installed = []
        try:
            for incoming, destination in pending:
                if destination.is_symlink() or destination.exists():
                    raise FileExistsError(f"Destination appeared during installation: {destination}")
                incoming.rename(destination)
                installed.append((incoming, destination))
        except (OSError, KeyboardInterrupt):
            for incoming, destination in reversed(installed):
                destination.rename(incoming)
            raise

    for name in current:
        print(f"Already installed: {name}")
    for _, destination in installed:
        print(f"Installed: {destination.name}")
    print("Restart ComfyUI and refresh the interface.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("custom_nodes", type=Path, help="Your ComfyUI custom_nodes folder")
    args = parser.parse_args()
    try:
        install_nodes(Path(__file__).resolve().parent, args.custom_nodes.expanduser().resolve())
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
