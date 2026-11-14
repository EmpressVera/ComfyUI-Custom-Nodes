"""Install or update the node packages in this repository."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile


MANIFEST = ".empressvera-installed.json"


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def installed_hash(path):
    if path.is_symlink() or path.resolve() != path:
        raise ValueError(f"Expected an ordinary file, found a link: {path}")
    if path.is_file():
        return file_hash(path)
    if path.exists():
        raise ValueError(f"Expected a file: {path}")
    return None


def load_manifest(path):
    installed_hash(path)
    contents = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(contents, dict):
        raise ValueError(f"Invalid installation record: {path}")
    for name, digest in contents.items():
        relative = PurePosixPath(name)
        if (
            relative.is_absolute()
            or not relative.parts
            or ".." in relative.parts
            or relative.as_posix() != name
            or "\\" in name
            or ":" in name
            or name.casefold() == MANIFEST.casefold()
            or not isinstance(digest, str)
            or len(digest) != 64
        ):
            raise ValueError(f"Invalid installation record: {path}")
    return contents


def plan_update(incoming, destination, latest, update):
    record = destination / MANIFEST
    if installed_hash(record) is None:
        differences = [
            name for name in latest if installed_hash(destination / name) != latest[name]
        ]
        if differences:
            files = ", ".join(differences)
            raise ValueError(
                f"{destination.name} has no installation record and differs in: {files}. "
                "Run this installer with the matching version of the node files first."
            )
        return [(incoming / MANIFEST, record)]

    previous = load_manifest(record)
    if previous == latest:
        return []
    if not update:
        raise ValueError(f"An update is available for {destination.name}. Rerun with --update.")

    changes = []
    for name in sorted(previous.keys() | latest.keys()):
        old_hash = previous.get(name)
        new_hash = latest.get(name)
        if old_hash == new_hash:
            continue
        target = destination / name
        actual_hash = installed_hash(target)
        if actual_hash == new_hash:
            continue
        if actual_hash != old_hash:
            raise ValueError(f"Local change conflicts with the update: {target}")
        changes.append((incoming / name if new_hash is not None else None, target))
    changes.append((incoming / MANIFEST, record))
    return changes


def install_nodes(repository, custom_nodes, update=False):
    if not custom_nodes.is_dir():
        raise ValueError(f"Choose an existing ComfyUI custom_nodes folder: {custom_nodes}")
    if custom_nodes == repository or custom_nodes in repository.parents:
        raise ValueError("Move the downloaded repository outside custom_nodes before installing.")
    if repository in custom_nodes.parents:
        raise ValueError("Choose a custom_nodes folder outside the downloaded repository.")

    packages = sorted(
        folder for folder in repository.glob("comfyui-*")
        if folder.is_dir() and (folder / "__init__.py").is_file()
    )
    if not packages:
        raise ValueError("No node packages found. Keep install.py with the downloaded node folders.")

    license_file = repository / "LICENSE"
    with tempfile.TemporaryDirectory(prefix=".empressvera-install-", dir=custom_nodes) as stage:
        staging = Path(stage)
        pending = []
        messages = []
        for package in packages:
            incoming = staging / package.name
            destination = custom_nodes / package.name
            shutil.copytree(
                package, incoming,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git", MANIFEST),
            )
            if license_file.is_file():
                shutil.copy2(license_file, incoming / "LICENSE-EmpressVera")

            latest = {
                path.relative_to(incoming).as_posix(): file_hash(path)
                for path in sorted(incoming.rglob("*")) if path.is_file()
            }
            (incoming / MANIFEST).write_text(json.dumps(latest, indent=2) + "\n", encoding="utf-8")
            if destination.is_symlink() or destination.resolve() != destination:
                raise ValueError(f"Existing node folder is a link: {destination}")
            if not destination.exists():
                pending.append((incoming, destination))
                messages.append(f"Installed: {package.name}")
            elif destination.is_dir():
                changes = plan_update(incoming, destination, latest, update)
                pending.extend(changes)
                status = "Updated or recorded" if changes else "Already up to date"
                messages.append(f"{status}: {package.name}")
            else:
                raise ValueError(f"Expected a node folder: {destination}")

        completed = []
        backups = staging / "backups"
        backups.mkdir()
        try:
            for index, (incoming, destination) in enumerate(pending):
                destination.parent.mkdir(parents=True, exist_ok=True)
                backup = backups / str(index)
                if destination.exists():
                    if destination.is_dir():
                        raise FileExistsError(f"Destination already exists: {destination}")
                    destination.rename(backup)
                completed.append((incoming, destination, backup))
                if incoming is not None:
                    incoming.rename(destination)
        except (OSError, KeyboardInterrupt):
            for incoming, destination, backup in reversed(completed):
                if incoming is not None and destination.exists():
                    destination.rename(incoming)
                if backup.exists():
                    backup.rename(destination)
            raise

    for message in messages:
        print(message)
    print("Restart ComfyUI and refresh the interface.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("custom_nodes", type=Path, help="Your ComfyUI custom_nodes folder")
    parser.add_argument("--update", action="store_true", help="Apply changes to installed nodes")
    args = parser.parse_args()
    destination = args.custom_nodes.expanduser().resolve()
    try:
        lock = destination / ".empressvera-install.lock"
        if not destination.is_dir():
            raise ValueError(f"Choose an existing ComfyUI custom_nodes folder: {destination}")
        try:
            lock.touch(exist_ok=False)
        except FileExistsError:
            raise ValueError("Another install or update is already in progress.") from None
        try:
            install_nodes(Path(__file__).resolve().parent, destination, args.update)
        finally:
            lock.unlink()
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
