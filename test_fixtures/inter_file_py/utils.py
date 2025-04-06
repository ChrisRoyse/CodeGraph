PI = 3.14159

def calculate_circumference(radius):
    """Calculates the circumference of a circle."""
    return 2 * PI * radius

class Circle:
    def __init__(self, radius):
        self.radius = radius

    def area(self):
        """Calculates the area of the circle."""
        return PI * (self.radius ** 2)