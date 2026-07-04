import subprocess
import unittest


class TestSkillBundle(unittest.TestCase):
    def run_check(self, check_name: str):
        result = subprocess.run(
            ["python3", "scripts/verify_skill_bundle.py", "--check", check_name],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_structure_check_passes(self):
        self.run_check("structure")

    def test_core_check_passes(self):
        self.run_check("core")

    def test_planning_check_passes(self):
        self.run_check("planning")

    def test_methods_check_passes(self):
        self.run_check("methods")

    def test_analysis_check_passes(self):
        self.run_check("analysis")

    def test_impact_check_passes(self):
        self.run_check("impact")

    def test_templates_check_passes(self):
        self.run_check("templates")

    def test_prompts_check_passes(self):
        self.run_check("prompts")

    def test_all_check_passes(self):
        self.run_check("all")


if __name__ == "__main__":
    unittest.main()
