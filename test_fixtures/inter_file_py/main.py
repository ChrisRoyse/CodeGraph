import utils
from utils import calculate_circumference, Circle

def run_calculations(radius):
    print(f"Using PI: {utils.PI}") # Access via module
    
    circumference = calculate_circumference(radius) # Direct import usage
    print(f"Circumference: {circumference}")

    my_circle = Circle(radius) # Direct import usage
    circle_area = my_circle.area()
    print(f"Area: {circle_area}")

if __name__ == "__main__":
    run_calculations(5)